
class GameManager {
  constructor(color, InputManager, Actuator, Gadget, socket) {
    this.types        = ["red", "blue", "green", "yellow"];
    this.size         = 4; // Size of the grid
    // color will be virus color (red, blue, green, yellow)
    this.copeWith     = color;
    this.inputManager = new InputManager();
    this.actuator     = new Actuator(color);
    this.gadget       = new Gadget(color);
    this.socket       = socket;
    this.startTiles   = 2; // Start tile count
    this.syringeValue = window.urlParams.get('syringeValue') || 30;
    this.packValue    = window.urlParams.get('packValue') || 20;
    this.over         = false; // over: Only this player failed this puzzle.
    this.won          = false; // won:  This player successfully created a vaccine.
    this.allOver      = false; // allOver: All players failed this game (ex. time's up).
    this.allWon       = false; // allWon:  All players successfully created a vaccine.
    this.createdVaccines = {
      red:    false,
      blue:   false,
      yellow: false,
      green:  false,
    };
    this.receivedKnowledge = 0;
    this.myProgress = 0;

    this.inputManager.on("move", this.move.bind(this));
    this.inputManager.on("restart", this.restart.bind(this));
    this.socket.on("game-event", this.gameEventListener.bind(this));

    this.setup();
  }

  isTerminated() {
    return this.allOver || this.allWon;
  }

  // Restart the game
  restart() {
    if (this.isTerminated()) return; // do nothing when game is terminated.

    this.actuator.clearMessage(); // Clear the game won/lost message
    this.setup();
  }

  gameEventListener(receivedData) {
    if (this.isTerminated()) return; // do nothing when game is terminated.

    // knowledge
    if (receivedData.knowledge) {
      if (receivedData.knowledge === this.copeWith) {
        this.receivedKnowledge++;
      }
      this.gadget.incrementPackNum(receivedData.knowledge);
    }

    // vaccine
    if (receivedData.vaccine) {
      this.createdVaccines[receivedData.vaccine] = true;
      this.gadget.addSyringe(receivedData.vaccine);

      var isCreatedAllVaccines =
        Utils.hashValues(this.createdVaccines).every(x => x);
      if (isCreatedAllVaccines) {
        this.allWon = true;
        // TODO: all players won!
        console.log("game clear!!");
        this.actuator.terminateGame({
          allWon: true,
          reason: "Congratulations, you saved the world!"
        });
      }
    }

    // outbreak
    if (receivedData.outbreak) {
      var outbreakStep = this.gadget.incrementOutbreak();
      if (outbreakStep === 8) {
        this.allOver = true;
        // TODO: all players will be game over!
        console.log("game over!!");
        this.actuator.terminateGame({
          allOver: true,
          reason: "Too many outbreak has occurred."
        });
      }
    }

    // infection rate
    if (receivedData.time) {
      var infectionRate = this.gadget.incrementInfectionRate();
      if (infectionRate === 6) {
        this.allOver = true;
        // TODO: all players will be game over!
        console.log("game over!!");
        this.actuator.terminateGame({
          over: true,
          reason: "Infection rate is up to limit."
        });
      }
    }

    // progress
    if (receivedData.progress) {
      var color = receivedData.from;
      this.gadget.setProgress(color, receivedData.progress);
    }
  }

  // Set up the game
  setup() {
    var self = this;

    this.grid  = new Grid(this.size);
    this.score = 0;
    this.over  = false;

    // Add the initial tiles
    for (var i = 0; i < this.startTiles; i++) {
      this.addRandomTile();
    }

    // Update the actuator
    this.actuate();
  }

  // Adds a tile in a random position
  addRandomTile(color) {
    if (this.grid.hasEmptyCell()) {
      var value = Math.random() < this.receivedKnowledge * 0.05 ? 4 : 2;
      var tile = new Tile(this.grid.randomAvailableCell(), value, color);

      this.grid.insertTile(tile);
    }
  }

  // Sends the updated grid to the actuator
  actuate() {
    this.actuator.actuate(this.grid, {
      score:      this.score,
      over:       this.over,
      won:        this.won,
      copeWith:   this.copeWith,
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
    var sendSocketData = {};

    var vector     = this.getVector(direction);
    var traversals = this.buildTraversals(vector);
    var moved      = false;

    if (this.isTerminated()) return; // do nothing when game is terminated.

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

          if (next && next.type === tile.type/* && !next.mergedFrom */) {
            // Merge tiles
            var merged = new Tile(positions.next, next.value + tile.value, tile.type);
            tile.willDisappear = next.willDisappear = true;
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

        if (self.won && tile.value >= self.packValue ||
            tile.type !== self.copeWith && tile.value >= self.packValue) {
          tile.pack = true;
          console.log("Share knowledge: " + tile.type);
          sendSocketData.knowledge = tile.type;
        } else if (tile.value >= self.syringeValue && tile.type === self.copeWith) {
          tile.syringe = true;
          self.won = true;
          console.log("Finish developing vaccine: " + tile.type);
          sendSocketData.vaccine = tile.type;
        }
      })
    });

    if (moved) {
      this.addRandomTile();

      if (!this.movesAvailable()) {
        this.over = true;
        console.log("game over");
        sendSocketData.outbreak = true;
        // TODO: show message and restart soon.
        this.actuator.message({ over: true });
      }

      // Share progress
      var progress = this.estimateProgress();
      console.log(progress, this.myProgress);
      if (progress > this.myProgress) {
        console.log(progress);
        this.myProgress = progress;
        sendSocketData.progress = progress;
      }

      if (Object.keys(sendSocketData).length > 0) {
        sendSocketData.from = this.copeWith;
        this.socket.emit('game-new-event', sendSocketData);
      }

      this.actuate();
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
    return this.grid.hasEmptyCell() || this.hasPackOrSyringe() || this.tileMatchesAvailable();
  }

  hasPackOrSyringe() {
    for (var x = 0; x < this.size; x++) {
      for (var y = 0; y < this.size; y++) {
        var tile = this.grid.cellContent({ x: x, y: y });
        if (tile && (tile.pack || tile.syringe)) {
          return true;
        }
      }
    }
    return false;
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

  // Return process between 0 and 100.
  estimateProgress() {
    if (this.won) return 100;

    var maxMyColorValue = 0;
    for (var x = 0; x < this.size; x++) {
      for (var y = 0; y < this.size; y++) {
        var tile = this.grid.cellContent({ x: x, y: y });
        if (tile && tile.type === this.copeWith && tile.value > maxMyColorValue) {
          maxMyColorValue = tile.value;
        }
      }
    }
    var progress = maxMyColorValue * 100 / this.syringeValue;
    return Math.floor(progress);
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
