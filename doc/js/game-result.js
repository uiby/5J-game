
class GameResult {
  constructor() {
    this.gameResultWrapper = document.querySelector('.game-result-wrapper');
    this.gameResultWrapper.style.transition = 'opacity 500ms ease';

    this.phaseDesc = {
      1: "人への感染報告はまだない",
      2: "動物から人へ感染するリスクが高いウイルスが検出された",
      3: "動物から人への感染が確認されている",
      4: "人から人への感染が確認されている",
      5: "人から人へのより大きな集団感染が確認されている",
      6: "パンデミックが発生し、急速に感染が拡大している",
    };

    gameEvent.on('game-reset', () => {
      this.hide();
    });
  }

  show(createdVaccines, createdKnowledge, phase) {
    // be visible
    this.gameResultWrapper.style.opacity = 1;

    // win/lose
    var isCreatedAllVaccines = Utils.values(createdVaccines).every(x => x > 0);
    var gameResultTitle = this.gameResultWrapper.querySelector('.game-result-title');
    if (isCreatedAllVaccines) {
      gameResultTitle.textContent = "人類勝利";
    } else {
      gameResultTitle.textContent = "人類滅亡";
    }


    // vaccines
    for (var type in createdVaccines) {
      var syringe = this.gameResultWrapper.querySelector('.syringe-' + type);
      if (createdVaccines[type] > 0) {
        syringe.style.opacity = 1;
      } else {
        syringe.style.opacity = 0.1;
      }
    }

    // knowledge
    var packCount = Utils.values(createdKnowledge).reduce((a, b) => a + b);
    var packCountDOM = this.gameResultWrapper.querySelector('.pack-count');
    packCountDOM.textContent = packCount;

    // phase
    var phaseDOM = document.querySelector('.phase');
    phaseDOM.textContent = phase;
    var phaseDescDOM = document.querySelector('.phase-desc');
    phaseDescDOM.textContent = this.phaseDesc[phase];
  }

  hide() {
    // be unvisible
    this.gameResultWrapper.style.opacity = 0;

    // vaccines
    var types = ['red', 'yellow', 'green', 'blue'];
    for (var type of types) {
      var syringe = this.gameResultWrapper.querySelector('.syringe-' + type);
      syringe.style.opacity = 0.1;
    }

    // knowledge
    var packCountDOM = this.gameResultWrapper.querySelector('.pack-count');
    packCountDOM.textContent = 0;

    // phase
    var phaseDOM = document.querySelector('.phase');
    phaseDOM.textContent = '';
    var phaseDescDOM = document.querySelector('.phase-desc');
    phaseDescDOM.textContent = '';
  }
}
