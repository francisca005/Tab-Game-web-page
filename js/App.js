// js/App.js
import { UIManager } from "./UIManager.js";
import { TabGame } from "./TabGame.js";
import { OnlineGame } from "./OnlineGame.js";


document.addEventListener("DOMContentLoaded", () => {

  const ui = new UIManager();
  const localGame = new TabGame(ui);
  const onlineGame = new OnlineGame(ui);

  // Por omissão, assumimos modo local
  ui.onThrow = () => localGame.rollSticks();
  ui.onQuit  = () => localGame.quitGame();

  // onGoToGame escolhe o motor
  ui.onGoToGame = ({ cols, mode, first, aiLevel }) => {
    if (mode === "pvc" || mode === "pvp_local") {
      // jogo local original
      localGame.init(cols, first);
      ui.addMessage("System", `New LOCAL game: ${mode}, first to play: ${first}.`);
    } else if (mode === "pvp_online") {
      // jogo online
      ui.addMessage("System", "Starting ONLINE game...");
      onlineGame.start(cols);
    }

    document.querySelector(".bottom")?.scrollIntoView({ behavior: "smooth" });
  };


  ui.onConfigChange = () => ui.updateAIVisibility();

  // Inicializa listeners e visibilidade do menu de AI
  ui.initListeners();
  ui.updateAIVisibility(); 

  // Cria o tabuleiro inicial
  localGame.init(9, "Gold");

  // Modal de regras (PUSH-UP)
  const ruleItems = document.querySelectorAll(".rules details");
  const overlay = document.getElementById("ruleOverlay");
  const ruleTitle = document.getElementById("ruleTitle");
  const ruleText = document.getElementById("ruleText");
  const ruleVideo = document.getElementById("ruleVideoModal");
  const videoSource = ruleVideo.querySelector("source");
  const closeRuleBtn = document.querySelector(".close-rule");

  ruleItems.forEach(item => {
    const summary = item.querySelector("summary");
    summary.addEventListener("click", (e) => {
      e.preventDefault(); // impede abrir o <details>
      const title = summary.textContent.trim();
      const textContainer = item.querySelector("div, p");
      const text = textContainer ? textContainer.innerHTML : "";


      // define conteúdo no overlay
      ruleTitle.textContent = title;
      ruleText.innerHTML = text;

      // define o vídeo correto (link absoluto no servidor)
      const rule = item.dataset.rule;
      videoSource.src = `http://www.alunos.dcc.fc.up.pt/~up202303448/tab_videos/${rule}.mp4`;

      ruleVideo.load();
      ruleVideo.play();

      // mostra o overlay
      overlay.classList.remove("hidden");
    });
  });

  if (closeRuleBtn) {
    closeRuleBtn.addEventListener("click", () => {
      ruleVideo.pause();
      overlay.classList.add("hidden");
    });
  }


  // Botão de ir para configurações
  const goToConfigBtn = document.getElementById("goToConfigBtn");
  if (goToConfigBtn) {
    goToConfigBtn.addEventListener("click", (e) => {
      e.preventDefault();
      document.getElementById("configurations")
        .scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  // classificações - guarda resultados  
  window.recordGameResult = function (winner, piecesLeft) {
    const result = {
      date: new Date().toISOString().split("T")[0],
      winner,
      piecesLeft,
    };

    const classifications = JSON.parse(localStorage.getItem("classifications")) || [];
    classifications.push(result);
    localStorage.setItem("classifications", JSON.stringify(classifications));
  };

    // Classificações - POPUP 
  const openClassificationsBtn = document.getElementById("openClassificationsBtn");
  const classificationsOverlay = document.getElementById("classificationsOverlay");
  const closeClassificationsBtn = document.querySelector(".close-classifications");
  const classificationsTableContainer = document.getElementById("classificationsTableContainer");

  function renderClassifications() {
    const classifications = JSON.parse(localStorage.getItem("classifications")) || [];

    // Caso não existam resultados
    if (classifications.length === 0) {
      classificationsTableContainer.innerHTML = "<p>No games played yet.</p>";
      return;
    }

    // Ordena por número de peças restantes (decrescente)
    classifications.sort((a, b) => {
      const piecesA = parseInt(a.piecesLeft) || 0;
      const piecesB = parseInt(b.piecesLeft) || 0;
      return piecesB - piecesA; // decrescente
    });
    

    // Cria tabela HTML
    let tableHTML = `
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Winner</th>
            <th>Pieces Left</th>
          </tr>
        </thead>
        <tbody>
    `;

    classifications.forEach((c) => {
      tableHTML += `
        <tr>
          <td>${c.date}</td>
          <td>${c.winner}</td>
          <td>${c.piecesLeft}</td>
        </tr>
      `;
    });

    tableHTML += "</tbody></table>";
    classificationsTableContainer.innerHTML = tableHTML;
  }

  // Abertura do popup  
  if (openClassificationsBtn) {
    openClassificationsBtn.addEventListener("click", () => {
      renderClassifications();
      classificationsOverlay.classList.remove("hidden");

      //Reaplica animação sempre que abre
      const popup = classificationsOverlay.querySelector(".classifications-popup");
      popup.classList.remove("animate-in", "animate-in-left"); 
      void popup.offsetWidth; // reflow para reiniciar
      popup.classList.add("animate-in");                       
      
    });
  }
  // Fechar popup
  if (closeClassificationsBtn) {
    closeClassificationsBtn.addEventListener("click", () => {
      classificationsOverlay.classList.add("hidden");
    });
  }
 

});
