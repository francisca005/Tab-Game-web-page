// js/App.js
import { UIManager } from "./UIManager.js";
import { TabGame } from "./TabGame.js";
import { OnlineGame } from "./OnlineGame.js";

document.addEventListener("DOMContentLoaded", () => {

  const ui = new UIManager();
  let localGame = new TabGame(ui);
  const onlineGame = new OnlineGame(ui, {
    serverUrl: "http://twserver.alunos.dcc.fc.up.pt:8008",
    group: 4567,
  });

  let activeMode = "local"; // "local" | "online"

  ui.onThrow = () => {
    if (activeMode === "online") return onlineGame.roll();
    return localGame.rollSticks();
  };

  ui.onQuit = async () => {
    if (activeMode === "online") {
      await onlineGame.leave();
      ui.addMessage("System", "Online: left the match.");
      activeMode = "local";
      return;
    }
    localGame.quitGame();
  };

  ui.onLogin = async (nick, pass) => {
    await onlineGame.login(nick, pass);
    sessionStorage.setItem("tab_nick", nick);
    sessionStorage.setItem("tab_pass", pass);
    ui.addMessage("System", `Sessão iniciada como ${nick}.`);
  };

  ui.onLogout = async () => {
    if (activeMode === "online") {
      await onlineGame.leave();
      activeMode = "local";
    }
    sessionStorage.removeItem("tab_nick");
    sessionStorage.removeItem("tab_pass");
    ui.addMessage("System", "Sessão terminada.");
  };

  const savedNick = sessionStorage.getItem("tab_nick");
  const savedPass = sessionStorage.getItem("tab_pass");
  if (savedNick && savedPass) {
    onlineGame.login(savedNick, savedPass)
      .then(() => ui.setAuthUI(true, savedNick))
      .catch(() => {});
  }

  ui.onGoToGame = async ({ cols, mode, first, aiLevel }) => {
    ui.resetGameUI();

    if (mode === "pvp_online") {
      // estando online, sai explicitamente do jogo anterior
      if (activeMode === "online") {
        await onlineGame.leave();
      }

      activeMode = "online";
      ui.clearHighlights(true);
      ui.setRollEnabled(false);
      ui.setSkipEnabled(false);

      const empty = Array.from({ length: 4 }, () => Array(cols).fill(null));
      ui.renderBoard(empty, "G", (r, c) => onlineGame.notifyByCoords(r, c));
      ui.updateCounts(0, 0);
      ui.addMessage("System", "Online: a procurar adversário...");

      onlineGame.start(cols).catch((e) => {
        ui.addMessage("System", `Online error: ${e.message || e}`);
        activeMode = "local";
      });

      document.querySelector(".bottom")?.scrollIntoView({ behavior: "smooth" });
      return;
    }

    // se mudar para local e estava online, sai do jogo
    if (activeMode === "online") {
      await onlineGame.leave();
    }

    activeMode = "local";
    localGame = new TabGame(ui);
    localGame.init(cols, first);

    let modeText = "";
    switch (mode) {
      case "pvp_local":
        modeText = "Player vs Player (same computer)";
        break;
      case "pvc":
        modeText = `Player vs Computer (${aiLevel})`;
        break;
    }

    ui.addMessage("System", `New game: ${modeText}, first to play: ${first}.`);
    document.querySelector(".bottom")?.scrollIntoView({ behavior: "smooth" });
  };

  ui.onConfigChange = () => ui.updateAIVisibility();

  ui.initListeners();
  ui.updateAIVisibility();

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
      e.preventDefault(); 
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
  
  //Ranking ONLINE (Player vs Player)
  const openRankingBtn = document.getElementById("openRankingBtn");
  const rankingOverlay = document.getElementById("rankingOverlay");
  const closeRankingBtn = document.querySelector(".close-ranking");
  const rankingTableContainer = document.getElementById("rankingTableContainer");

  function renderRankingTable(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
      rankingTableContainer.innerHTML = "<p>No ranking data yet.</p>";
      return;
    }

    let tableHTML = `
      <table>
        <thead>
          <tr>
            <th>Nick</th>
            <th>Victories</th>
            <th>Games</th>
          </tr>
        </thead>
        <tbody>
    `;

    rows.forEach((r) => {
      tableHTML += `
        <tr>
          <td>${r.nick}</td>
          <td>${r.victories}</td>
          <td>${r.games}</td>
        </tr>
      `;
    });

    tableHTML += "</tbody></table>";
    rankingTableContainer.innerHTML = tableHTML;
  }

  if (openRankingBtn) {
    openRankingBtn.addEventListener("click", async () => {
      try {
        const size = Number(document.getElementById("boardSize")?.value || 9);

        // ranking exige group + size
        const res = await onlineGame.api.ranking(onlineGame.group, size);

        if (res?.error) rankingTableContainer.innerHTML = `<p>${res.error}</p>`;
        else renderRankingTable(res?.ranking || []);

        rankingOverlay.classList.remove("hidden");
      } catch (e) {
        rankingTableContainer.innerHTML = `<p>Error: ${e.message || e}</p>`;
        rankingOverlay.classList.remove("hidden");
      }
    });
  }

  if (closeRankingBtn) {
    closeRankingBtn.addEventListener("click", () => {
      rankingOverlay.classList.add("hidden");
    });
  }


});
