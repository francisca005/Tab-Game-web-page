// js/App.js
import { UIManager } from "./UIManager.js";
import { TabGame } from "./TabGame.js";
import { OnlineGame } from "./OnlineGame.js";

document.addEventListener("DOMContentLoaded", () => {

  // Inicialização principal
  const ui = new UIManager();
  const localGame = new TabGame(ui);
  const onlineGame = new OnlineGame(ui);
  
  let activeGame = localGame; // Jogo ativo (local ou online)

  // Configurações e eventos do jogo 
  ui.onGoToGame = ({ cols, mode, first, aiLevel }) => {
    // 1. Modo PvC (local)
    if (mode === "pvc") {
      activeGame = localGame;

      localGame.init(cols, first, aiLevel);
      ui.addMessage(
        "System",
        `🎮 New LOCAL game (PvC): first to play: ${first}.`
      );

      // Callbacks do jogo local
      ui.onThrow = () => activeGame.rollSticks();
      ui.onQuit = () => activeGame.quitGame();
      ui.onPass = () => {
        activeGame.switchTurn();
        ui.setSkipEnabled(false);
      };
    }
    // 2. Modo PvP Online
    else if (mode === "pvp_online") {
      activeGame = onlineGame;

      ui.addMessage("System", "🌐 Starting ONLINE game...");
      onlineGame.start(cols);

      // Callbacks do jogo online
      ui.onThrow = () => activeGame.handleRoll();
      ui.onQuit = () => activeGame.quitGame();
      ui.onPass = () => activeGame.handlePass();
    }

    document.querySelector(".bottom")?.scrollIntoView({
      behavior: "smooth",
    });
  };

  ui.onConfigChange = () => ui.updateAIVisibility();

  // Inicializa listeners e visibilidade do menu de AI
  ui.initListeners();
  ui.updateAIVisibility(); 

  // Cria o tabuleiro inicial (modo local por defeito)
  localGame.init(9, "Gold");

  // Modal de regras (PUSH-UP)
  const ruleItems = document.querySelectorAll(".rules details");
  const overlay = document.getElementById("ruleOverlay");
  const ruleTitle = document.getElementById("ruleTitle");
  const ruleText = document.getElementById("ruleText");
  const ruleVideo = document.getElementById("ruleVideoModal");
  const videoSource = ruleVideo?.querySelector("source");
  const closeRuleBtn = document.querySelector(".close-rule");

  ruleItems.forEach(item => {
    const summary = item.querySelector("summary");
    summary.addEventListener("click", (e) => {
      e.preventDefault();
      const title = summary.textContent.trim();
      const textContainer = item.querySelector("div, p");
      const text = textContainer ? textContainer.innerHTML : "";

      ruleTitle.textContent = title;
      ruleText.innerHTML = text;

      const rule = item.dataset.rule;
      if (videoSource) {
        videoSource.src = `http://www.alunos.dcc.fc.up.pt/~up202303448/tab_videos/${rule}.mp4`;
      }

      if (ruleVideo) {
        ruleVideo.load();
        ruleVideo.play();
      }

      overlay.classList.remove("hidden");
    });
  });

  if (closeRuleBtn) {
    closeRuleBtn.addEventListener("click", () => {
      if (ruleVideo) ruleVideo.pause();
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

  // Classificações - guarda resultados  
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

    if (classifications.length === 0) {
      classificationsTableContainer.innerHTML = "<p>No games played yet.</p>";
      return;
    }

    classifications.sort((a, b) => {
      const piecesA = parseInt(a.piecesLeft) || 0;
      const piecesB = parseInt(b.piecesLeft) || 0;
      return piecesB - piecesA;
    });

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

  if (openClassificationsBtn) {
    openClassificationsBtn.addEventListener("click", async () => {
      // Se estiver autenticado, mostra ranking do servidor
      if (ui.nick && ui.password) {
        await ui.fetchAndRenderServerRanking();
      } else {
        // Senão, mostra classificações locais
        renderClassifications();
        ui.addMessage("System", "Showing local results. Log in to see Server Ranking.");
      }
      
      classificationsOverlay.classList.remove("hidden");

      const popup = classificationsOverlay.querySelector(".classifications-popup");
      popup.classList.remove("animate-in", "animate-in-left"); 
      void popup.offsetWidth;
      popup.classList.add("animate-in");                       
    });
  }

  if (closeClassificationsBtn) {
    closeClassificationsBtn.addEventListener("click", () => {
      classificationsOverlay.classList.add("hidden");
    });
  }
});