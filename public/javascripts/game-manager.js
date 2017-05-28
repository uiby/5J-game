
class GameManager {
  constructor(color, InputManager, Actuator, socket) {
    this.size         = 4; // Size of the grid
    this.copeWith     = color; // color will be virus color (red, blue, green, yellow)
    this.inputManager = new InputManager;
    this.actuator     = new Actuator(color);
    this.socket       = socket;
    this.startTiles   = 2; // Start tile count
    this.syringeValue = 30;
    this.packValue    = 20;

    this.inputManager.on("move", this.move.bind(this));
    this.inputManager.on("restart", this.restart.bind(this));
    this.socket.on("game-event", this.gameEventListener.bind(this));

    this.setup();
  }

  // Restart the game
  restart() {
    this.actuator.clearMessage(); // Clear the game won/lost message
    this.setup();
  }

  // Return true if the game is lost, or has won
  isGameTerminated() {
    return this.over || this.won;
  }

  gameEventListener(received_data) {
    if (received_data.knowledge === this.copeWith) {
      // It's very helpful
      console.log('received knowledge: ' + received_data.knowledge);
    }
  }

  // Set up the game
  setup() {
    var self = this;

    this.grid  = new Grid(this.size);
    this.score = 0;
    this.over  = false;
    this.won   = false;

    // Add the initial tiles
    for (var i = 0; i < this.startTiles; i++) {
      this.addRandomTile();
    }

    // Update the actuator
    this.actuate();
  }

  // Adds a tile in a random position
  addRandomTile() {
    if (this.grid.hasEmptyCell()) {
      var value = Math.random() < 0.9 ? 2 : 4;
      var tile = new Tile(this.grid.randomAvailableCell(), value);

      this.grid.insertTile(tile);
    }
  }

  // Sends the updated grid to the actuator
  actuate() {
    this.actuator.actuate(this.grid, {
      score:      this.score,
      over:       this.over,
      won:        this.won,
      terminated: this.isGameTerminated()
    });
  }

  // Save all tile positions and remove merger info
  prepareTiles() {
    this.grid.eachCell(function (x, y, tile) {
      if (tile) {
        tile.mergedFrom = null;
        tile.savePosition();
      }
    });
  }

  // Move a tile
  moveTile(tile, cell) {
    this.grid.cells[tile.x][tile.y] = null;
    this.grid.cells[cell.x][cell.y] = tile;
    tile.updatePosition(cell);
  }

  // Move tiles on the grid in the specified direction
  move(direction) {
    // 0: up, 1: right, 2: down, 3: left
    var self = this;
    var send_socket_data = {};

    if (this.isGameTerminated()) return; // Don't do anything if the game's over

    var vector     = this.getVector(direction);
    var traversals = this.buildTraversals(vector);
    var moved      = false;

    // Save the current tile positions and remove merger information
    this.prepareTiles();

    // Traverse the grid in the right direction and move tiles
    traversals.x.forEach(function (x) {
      traversals.y.forEach(function (y) {
        var cell = { x: x, y: y };
        var tile = self.grid.cellContent(cell);

        if (tile) {
          var positions = self.findFarthestPosition(cell, vector);
          var next      = self.grid.cellContent(positions.next);

          // Only one merger per row traversal?
          if (next && next.type === tile.type && !next.mergedFrom) {
            var merged = new Tile(positions.next, next.value + tile.value, tile.type);
            merged.mergedFrom = [tile, next];

            self.grid.insertTile(merged);
            self.grid.removeTile(tile);

            // Converge the two tiles' positions
            tile.updatePosition(positions.next);

            // Update the score
            //self.score += merged.value;
          } else {
            self.moveTile(tile, positions.farthest);
          }

          if (!self.positionsEqual(cell, tile)) {
            moved = true; // The tile moved from its original cell!
          }
        }
      });
    });

    // Extract a packed knowledge and a vaccine
    traversals.x.forEach(function (x) {
      traversals.y.forEach(function (y) {
        var cell = { x: x, y: y };
        var tile = self.grid.cellContent(cell);
        if (!tile) return;

        if (tile.value >= self.syringeValue && tile.type === self.copeWith) {
          tile.syringe = true;
          self.won = true;
          console.log("Finish developing vaccine: " + tile.type);
          send_socket_data.vaccine = tile.type;
        } else if (tile.value >= self.packValue && tile.type !== self.copeWith) {
          tile.pack = true;
          console.log("Share knowledge: " + tile.type);
          send_socket_data.knowledge = tile.type;
        }
      })
    });

    if (moved) {
      this.addRandomTile();

      if (!this.movesAvailable()) {
        this.over = true; // Game over!
        console.log("game over");
      }

      if (Object.keys(send_socket_data).length > 0) {
        this.socket.emit('game-new-event', send_socket_data);
      }

      this.actuate();

      // When tiles are merged, there are some extra tiles under the merged tile,
      // so we need to remove them but css transition duration is about 200ms (
      // position movement is about 100ms but pop animation takes 200ms), and so
      // we should actuate the html renderer after 250ms.
      setTimeout(function () {
        self.prepareTiles();
        self.actuate();
      }, 250);
    }
  }

  // Get the vector representing the chosen direction
  getVector(direction) {
    var map = {
      0: { x: 0,  y: -1 }, // Up
      1: { x: 1,  y: 0 },  // Right
      2: { x: 0,  y: 1 },  // Down
      3: { x: -1, y: 0 }   // Left
    };
    return map[direction];
  }

  // Build a list of positions to traverse in the right order
  // ex)
  //     when vector = ( 0, -1) // Up
  //       return { x: [0,1,2,3], y: [0,1,2,3] }
  //     when vector = ( 1,  0) // Right
  //       return { x: [3,2,1,0], y: [0,1,2,3] }
  //     when vector = ( 0,  1) // Down
  //       return { x: [0,1,2,3], y: [3,2,1,0] }
  //     when vector = ( 1,  0) // Left
  //       return { x: [0,1,2,3], y: [0,1,2,3] }
  //
  buildTraversals(vector) {
    var traversals = { x: [], y: [] };

    for (var pos = 0; pos < this.size; pos++) {
      traversals.x.push(pos);
      traversals.y.push(pos);
    }
    // Always traverse from the farthest cell in the chosen direction
    if (vector.x === 1) traversals.x = traversals.x.reverse();
    if (vector.y === 1) traversals.y = traversals.y.reverse();
    return traversals;
  }

  findFarthestPosition(cell, vector) {
    var previous;

    // Progress towards the vector direction until an obstacle is found
    do {
      previous = cell;
      cell     = { x: previous.x + vector.x, y: previous.y + vector.y };
    } while (this.grid.withinBounds(cell) &&
             this.grid.cellAvailable(cell));

    return {
      farthest: previous,
      next: cell // Used to check if a merge is required
    };
  }

  movesAvailable() {
    return this.grid.hasEmptyCell() || this.tileMatchesAvailable();
  }

  // Check for available matches between tiles (more expensive check)
  tileMatchesAvailable() {
    var self = this;

    for (var x = 0; x < this.size; x++) {
      for (var y = 0; y < this.size; y++) {
        var tile = this.grid.cellContent({ x: x, y: y });

        if (tile) {
          for (var direction = 0; direction < 4; direction++) {
            var vector = self.getVector(direction);
            var cell   = { x: x + vector.x, y: y + vector.y };
            var other  = self.grid.cellContent(cell);

            if (other && other.type === tile.type) {
              return true; // These two tiles can be merged
            }
          }
        }
      }
    }
    return false;
  }

  positionsEqual(a, b) {
    return a.x === b.x && a.y === b.y;
  }
}

// Class propaties and class methods

// {red: "pink", blue: "lightblue", green: "lightgreen", yellow: "yellow"}
GameManager.colors    = ["red",  "blue",      "green",      "yellow"];
GameManager.cssColors = ["pink", "lightblue", "lightgreen", "yellow"];
GameManager.cssColorMap = (function () {
  var hash = {};
  for (var i = 0; i < GameManager.colors.length; i++) {
    hash[GameManager.colors[i]] = GameManager.cssColors[i];
  }
  return hash;
}());