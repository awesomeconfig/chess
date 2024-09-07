$(document).ready(function () {
  // ------------------------------------
  // Global Variables and Initialization
  // ------------------------------------

  let board = Chessboard("board", {
    draggable: true,
    position: "start",
    onDrop: handleMove,
  });

  let reviewBoard = Chessboard("board-review", {
    draggable: false, // Disable dragging on review board
    position: "start",
  });

  let game = new Chess();
  let currentGameIndex = -1;
  let moveFenMap = new Map();
  let currentOpening = "Starting Position";
  let currentEngine = "stockfish";
  let engineElo = 2500;
  let engine = createEngine(currentEngine);
  let depth = 18;
  let analysisRunning = true;
  let isEnginePlaying = false;
  let humanPlayerColor = "w";
  let whiteTimer, blackTimer;
  let whiteTimeLeft, blackTimeLeft;
  let whiteIncrement = 0;
  let blackIncrement = 0;
  let gameActive = false;

  let mastersMoves = [];
  let openings = [];
  let previousEval = null;
  let currentEval = 0;
  let bestMove = null;
  let current_bestmove = null;

  let bestMoveArrow = null;
  let reviewDepth = 18;
  let reviewProgress = 0;
  let moveClassifications = [];

  // Fetch opening data
  fetch("openings.json")
    .then((response) => response.json())
    .then((openingsData) => {
      openings = openingsData;
    })
    .catch((error) => {
      console.error("Error fetching openings:", error);
    });

  fetchLichessMoves();
  showOpeningName();
  createBestMoveArrow();

  // ------------------------------------
  // Event Handlers
  // ------------------------------------

  $("#move-list").on("mouseenter", "li", function () {
    $(this).css({ cursor: "pointer", color: "yellow" });
  }).on("mouseleave", "li", function () {
    $(this).css({ cursor: "default", color: "white" });
  });

  $("#review-game-btn").on("click", reviewCurrentGame);
  $("#review-depth").on("change", function () {
    reviewDepth = $(this).val();
  });

  // ------------------------------------
  // Functions
  // ------------------------------------

  function goToMove(index) {
    currentGameIndex = index;
    const fen = moveFenMap.get(index);
    if (fen) {
      board.position(fen);
      updateMoveHistoryUI();
      showOpeningName();
    }
  }

  function previousMove() {
    if (currentGameIndex > 0 && !gameActive) {
      currentGameIndex--;
      goToMove(currentGameIndex);
    }
  }

  function nextMove() {
    if (currentGameIndex < game.history().length - 1 && !gameActive) {
      currentGameIndex++;
      goToMove(currentGameIndex);
    }
  }

  function stopRewinding() {
    clearInterval(previousMoveInterval);
  }

  function stopFastForwarding() {
    clearInterval(nextMoveInterval);
  }

  function displayGame(gameData) {
    gameActive = false;
    const movesList = gameData.movesList;

    try {
      movesList.forEach((move) => {
        game.move(move);
        board.position(game.fen());
      });

      currentGameIndex = movesList.length - 1;
      populateMoveFenMap();
      updateMoveHistoryUI();
      showOpeningName();
      restartAnalysis();

      console.log("Loaded game:", gameData);
    } catch (error) {
      console.error("Error loading PGN:", error);
      alert("Invalid PGN data!");
    }
    gameActive = true;
  }

  function populateMoveFenMap() {
    moveFenMap.clear();
    let tempGame = new Chess();
    game.history().forEach((move, index) => {
      tempGame.move(move);
      moveFenMap.set(index, tempGame.fen());
    });
  }

  function updateMoveHistoryUI() {
    const moveList = $("#move-list");
    moveList.empty();
    let moveNumber = 1;

    game
      .history({ verbose: true })
      .forEach((move, index) => {
        const moveText = `${moveNumber}. ${getMoveHTMLWithIcon(
          move,
          index
        )}`;

        const listItem = $("<li>")
          .html(moveText)
          .addClass(index % 2 === 0 ? "even-move" : "odd-move")
          .on("click", () => {
            if (!gameActive) {
              goToMove(index);
            }
          });
        moveList.append(listItem);

        moveNumber++;
      });
  }

  function createEngine(engineType) {
    if (engineType === "stockfish") {
      let stockfishEngine = new Worker("stockfish-nnue-16-single.js");
      stockfishEngine.postMessage("uci");
      stockfishEngine.postMessage(
        `setoption name UCI_Elo value ${engineElo}`
      );
      return stockfishEngine;
    } else {
      console.error("Unsupported engine type:", engineType);
      return null;
    }
  }

  function confirmFEN() {
    const fen = $("#fen-input").val();
    if (game.load(fen)) {
      board.position(fen);
      $("#fen-input").val("");
      updateMoveHistoryUI();
      restartAnalysis();
      fetchLichessMoves();
      showOpeningName();
    } else {
      alert("Invalid FEN position!");
    }
  }

  function resetBoard() {
    gameActive = false;
    game.reset();
    board.position(game.fen());
    currentGameIndex = -1;
    moveFenMap.clear();
    updateMoveHistoryUI();
    restartAnalysis();
    fetchLichessMoves();
    showOpeningName();
    isEnginePlaying = false;
    humanPlayerColor = "w";
    stopClock();

    engine.postMessage(`setoption name UCI_LimitStrength value false`);
  }

  function updateMastersMoves() {
    mastersMoves = $("#common-move-list-masters li")
      .map(function () {
        return $(this).text().split(" ")[0];
      })
      .get();
  }

  function handleMove(source, target) {
    if (isEnginePlaying && game.turn() !== humanPlayerColor) {
      return;
    }

    const move = game.move({
      from: source,
      to: target,
      promotion: "q",
    });

    if (move === null) return "snapback";

    processMove(move);
  }

  function processMove(move) {
    board.position(game.fen(), false);
    currentGameIndex++;
    populateMoveFenMap();
    updateMoveHistoryUI();
    updateMastersMoves();

    stopPlayerTimer(game.turn());
    startPlayerTimer(game.turn());

    if (analysisRunning) {
      analyzePosition(game.fen());
      fetchLichessMoves();
      showOpeningName();
      previousEval = currentEval;
    }

    checkGameEnd();

    if (isEnginePlaying && !game.game_over() && game.turn() !== humanPlayerColor) {
      window.setTimeout(makeEngineMove, 500);
    }

    // Update classification text in Analyze tab
    const classification = moveClassifications[currentGameIndex];
    $("#move-classification-text").text(classification || ""); 
  }

  function fetchLichessMoves() {
    const fen = game.fen();
    const urls = [
      `https://explorer.lichess.ovh/lichess?variant=standard&fen=${encodeURIComponent(
        fen
      )}`,
      `https://explorer.lichess.ovh/masters?variant=standard&fen=${encodeURIComponent(
        fen
      )}`,
    ];
    const listSelectors = ["#common-move-list", "#common-move-list-masters"];

    urls.forEach((url, index) => {
      fetch(url)
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Lichess API request failed: ${response.status}`);
          }
          return response.json();
        })
        .then((data) => {
          updateCommonMoves(data, listSelectors[index]);
        })
        .catch((error) => {
          console.error(error);
          $(listSelectors[index]).html(
            "<li>Error loading moves</li>"
          );
        });
    });
  }

  function updateCommonMoves(data, listSelector) {
    const moveList = $(listSelector);
    moveList.empty();

    if (!data || !data.moves) {
      moveList.html("<li>No moves found</li>");
      return;
    }

    data.moves.forEach((move) => {
      const white = parseInt(move.white, 10) || 0;
      const draw = parseInt(move.draw, 10) || 0;
      const black = parseInt(move.black, 10) || 0;

      const totalGames = white + draw + black;
      const winRate = (white / totalGames) * 100 || 0;
      const drawRate = (draw / totalGames) * 100 || 0;
      const lossRate = (black / totalGames) * 100 || 0;

      const listItem = $(`<li>${move.san} 
        <div class="win-loss-bar">
          <div class="win-bar" style="width: ${winRate}%"></div>
          <div class="draw-bar" style="width: ${drawRate}%"></div>
          <div class="loss-bar" style="width: ${lossRate}%"></div>
        </div>
      </li>`);

      moveList.append(listItem);
    });
  }


  function analyzePosition(fen) {
    const timeLeft = game.turn() === "w" ? whiteTimeLeft : blackTimeLeft;
    const increment = game.turn() === "w" ? whiteIncrement : blackIncrement;

    let goCommand = `go depth ${depth} wtime ${timeLeft} btime ${timeLeft} winc ${increment} binc ${increment}`;
    engine.postMessage(`position fen ${fen}`);
    engine.postMessage(goCommand); 

    engine.onmessage = function (event) {
      const message = event.data;
      if (message.includes("bestmove")) {
        bestMove = message.match(/bestmove\s+(\S+)/)[1];
        // Animate the best move arrow on the main Analyze board
        animateBestMoveArrow(bestMove);

        if (isEnginePlaying && game.turn() !== humanPlayerColor) {
          game.move(bestMove);
          processMove(bestMove);
        }
      }

      if (message.includes("pv")) {
        const pvStartIndex = message.indexOf("pv ") + 3;
        const pv = message.substring(pvStartIndex);

        current_bestmove = pv ? pv.trim().split(" ")[0] : null;
      }

      if (message.includes("score")) {
        currentEval = extractEvaluation(message);
        if (game.turn() === "b") {
          currentEval = -currentEval;
        }
        updateEvalBar(currentEval);
      }
    };
  }

  function extractEvaluation(engineMessage) {
    const cpMatch = engineMessage.match(/score\s+cp\s+([\+\-]?\d+)/);
    const mateMatch = engineMessage.match(/score\s+mate\s+([\+\-]?\d+)/);

    if (cpMatch) {
      const centiPawnsEval = parseInt(cpMatch[1], 10);
      return centiPawnsEval / 100;
    } else if (mateMatch) {
      const mateValue = parseInt(mateMatch[1], 10);
      return mateValue > 0 ? 1000 : -1000;
    } else {
      console.error(
        "Could not extract evaluation from engine message:",
        engineMessage
      );
      return 0;
    }
  }

  function isBrilliantMove(movePlayed, evalDiff, currentEval) {
    const materialDiff = getMaterialDifference(game.fen(), movePlayed.color);
    if (materialDiff < 0) {
      if (evalDiff <= 0.8) {
        return isSacrificeSound(game.fen(), currentEval);
      }
    }
    return false;
  }

  function isSacrificeSound(fen, previousEval) {
    engine.postMessage(`position fen ${fen}`);
    engine.postMessage(`go depth ${depth + 2}`);

    let sacrificeSound = false;

    return new Promise((resolve) => {
      const tempEngineListener = function (event) {
        const message = event.data;
        if (message.includes("score")) {
          var deeperEval = extractEvaluation(message);

          if (game.turn() === "b") {
            deeperEval = -deeperEval;
          }

          if (deeperEval < previousEval - 0.5) {
            sacrificeSound = true;
          }
          resolve(sacrificeSound);

          engine.removeEventListener("message", tempEngineListener);
        }
      };

      engine.addEventListener("message", tempEngineListener);
    });
  }

  function getMaterialDifference(fen, playerColor) {
    const pieceValues = { p: 1, n: 3, b: 3, r: 5, q: 9 };
    const fenPieces = fen.split(" ")[0];
    let materialSum = 0;

    for (let i = 0; i < fenPieces.length; i++) {
      const char = fenPieces[i];
      if (pieceValues.hasOwnProperty(char.toLowerCase())) {
        materialSum +=
          pieceValues[char.toLowerCase()] *
          (char === char.toLowerCase() ? -1 : 1);
      }
    }

    return playerColor === "w" ? materialSum : -materialSum;
  }

  function classifyMove(evalDiff, currentEval, movePlayed) {
    const absDiff = Math.abs(evalDiff);
    let classification = "Unknown";
    movePlayed = movePlayed.san;
    console.log("san",movePlayed)
    if (isBrilliantMove(movePlayed, evalDiff, currentEval)) {
      return "Brilliant Move";
    }

    switch (true) {
      case isGameOverOpportunityMissed(currentEval, movePlayed):
        classification = "Blundered Mate";
        break;
      case mastersMoves.includes(movePlayed.san):
        classification = "Book Move";
        break;
      case movePlayed.san === current_bestmove:
        if (previousEvalDiff > 1.5) {
          classification = "Great Move";
        } else {
          classification = "Best Move";
        }
        break;
      case absDiff > 3.0:
        classification = "Blunder";
        break;
      case absDiff >= 1.5:
        classification = "Mistake";
        break;
      case absDiff >= 1:
        classification = "Inaccuracy";
        break;
      case absDiff >= 0.5:
        classification = "Good Move";
        break;
      default:
        classification = "Solid Move";
    }
    return classification;
  }

  function isGameOverOpportunityMissed(currentEval, movePlayed) {
    const isMissedCheckmate =
      Math.abs(currentEval) > 900 && !movePlayed.san.includes("#");
    if (isMissedCheckmate) {
      return true;
    }

    return false;
  }

  function updateEvalBar(evalValue) {
    const evalBar = $("#eval-bar-inner");
    const evalText = $("#eval-text");

    if (typeof evalValue === "object" && evalValue.type === "mate") {
      evalBar.css("width", "100%");
      evalBar.css(
        "background-color",
        evalValue.value === 1
          ? "#76c7c0"
          : evalValue.value > 0
          ? "#76c7c0"
          : "#c77676"
      );
      evalText.text(`Evaluation: M${evalValue.value}`);
    } else {
      const percentage = 50 + evalValue * 50;
      evalBar.css("width", `${percentage}%`);
      evalBar.css("background-color", evalValue >= 0 ? "#76c7c0" : "#c77676");
      evalText.text(`Evaluation: ${evalValue.toFixed(2)}`);
    }
  }

  function toggleAnalysis() {
    analysisRunning = !analysisRunning;
    $("#analysis-control").text(
      analysisRunning ? "Pause Analysis" : "Resume Analysis"
    );

    if (analysisRunning) {
      restartAnalysis();
    } else {
      engine.postMessage("stop");
    }
  }

  function restartAnalysis() {
    engine.postMessage("stop");
    engine.postMessage(`setoption name UCI_Elo value ${engineElo}`);
    setTimeout(() => {
      analyzePosition(board.fen());
    }, 100);
  }

  function showOpeningName() {
    const currentFEN = game.fen();
    const moveCount = game.history().length;

    if (moveCount < 19) {
      let matchedOpening = openings.find((opening) => {
        return opening.fen.split(" ")[0] === currentFEN.split(" ")[0];
      });

      if (matchedOpening) {
        currentOpening = matchedOpening.name;
      }
    }

    $("#opening-name").text(currentOpening || "None");
  }

  function searchForGamesFromInput() {
    const player1Name = $("#player1-name").val().trim();
    const player2Name = $("#player2-name").val().trim();
    const resultFilter = $("#result-filter").val();
    const maxResults = $("#result-limit").val();

    if (!player1Name) {
      alert("Please enter at least Player 1's name.");
      return;
    }

    searchForGames(player1Name, player2Name, resultFilter, maxResults);
  }

  function searchForGames(player1Name, player2Name, resultFilter, maxResults) {
    const gameList = $("#game-list");
    gameList.empty();

    let searchUrl = `/search?player1=${encodeURIComponent(
      player1Name
    )}&maxResults=${maxResults}`;
    if (player2Name) {
      searchUrl += `&player2=${encodeURIComponent(player2Name)}`;
    }
    if (resultFilter) {
      searchUrl += `&result=${resultFilter}`;
    }

    fetch(searchUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error("Network response was not ok");
        }
        return response.json();
      })
      .then((games) => {
        if (games.length === 0) {
          gameList.append("<li>No games found matching the criteria.</li>");
        } else {
          games.forEach((game) => {
            const gameItem = $("<li>");
            const whitePlayer = game.White;
            const blackPlayer = game.Black;
            const result = game.Result;
            const viewGameBtn = $("<button>")
              .text("View Game")
              .addClass("btn btn-sm btn-light ms-2")
              .on("click", function () {
                displayGame(game);
              });

            gameItem
              .text(`${whitePlayer} vs ${blackPlayer} (${result}) `)
              .append(viewGameBtn);
            gameList.append(gameItem);
          });
        }
      })
      .catch((error) => {
        console.error("Error during search:", error);
        gameList.empty().append("<li>Error during search.</li>");
      });
  }

  function checkGameEnd() {
    if (game.game_over()) {
      let message = "";
      if (game.in_checkmate()) {
        message = game.history().length % 2 === 0 ? "Black wins!" : "White wins!";
      } else if (game.in_draw()) {
        message = "It's a draw!";
      } else if (game.in_stalemate()) {
        message = "It's a stalemate!";
      } else if (game.in_threefold_repetition()) {
        message = "It's a draw by threefold repetition!";
      } else if (game.insufficient_material()) {
        message = "It's a draw due to insufficient material!";
      }

      gameActive = false;
    }
  }

  function startGameVsEngine(color) {
    resetBoard();
    isEnginePlaying = true;
    humanPlayerColor = color;
    gameActive = true;

    engine.postMessage(`setoption name UCI_LimitStrength value true`);

    if (humanPlayerColor === "b") {
      makeEngineMove();
    }
  }

  function makeEngineMove() {
    if (game.game_over()) {
      handleGameOver();
      return;
    }

    analyzePosition(game.fen());
  }

  // ------------------------------------
  // Clock Functions
  // ------------------------------------

  function startClock() {
    const whiteTimeParts = $("#white-time").val().split(":");
    const blackTimeParts = $("#black-time").val().split(":");

    whiteTimeLeft =
      (parseInt(whiteTimeParts[0], 10) * 60 +
        parseInt(whiteTimeParts[1], 10)) *
      1000;
    blackTimeLeft =
      (parseInt(blackTimeParts[0], 10) * 60 +
        parseInt(blackTimeParts[1], 10)) *
      1000;

    whiteIncrement = parseInt($("#white-increment").val(), 10) || 0;
    blackIncrement = parseInt($("#black-increment").val(), 10) || 0;

    startPlayerTimer("w");
  }

  function startPlayerTimer(color) {
    stopPlayerTimer("w");
    stopPlayerTimer("b");

    if (color === "w") {
      whiteTimer = setInterval(() => {
        whiteTimeLeft -= 1000;
        updateClockDisplay("w");
        if (whiteTimeLeft <= 0) {
          handleTimeout("w");
        }
      }, 1000);
    } else {
      blackTimer = setInterval(() => {
        blackTimeLeft -= 1000;
        updateClockDisplay("b");
        if (blackTimeLeft <= 0) {
          handleTimeout("b");
        }
      }, 1000);
    }
  }

  function stopPlayerTimer(color) {
    if (color === "w") {
      clearInterval(whiteTimer);
      whiteTimeLeft += whiteIncrement;
      updateClockDisplay("w");
    } else {
      clearInterval(blackTimer);
      blackTimeLeft += blackIncrement;
      updateClockDisplay("b");
    }
  }

  function updateClockDisplay(color) {
    if (color === "w") {
      $("#white-clock").text(formatTime(whiteTimeLeft));
    } else {
      $("#black-clock").text(formatTime(blackTimeLeft));
    }
  }

  function handleTimeout(color) {
    stopClock();
    const loser = color === "w" ? "White" : "Black";
    gameActive = false;
  }

  function stopClock() {
    clearInterval(whiteTimer);
    clearInterval(blackTimer);
  }

  function formatTime(timeInMillis) {
    const minutes = Math.floor(timeInMillis / (60 * 1000));
    const seconds = Math.floor((timeInMillis % (60 * 1000)) / 1000);
    return `${padZero(minutes)}:${padZero(seconds)}`;
  }

  function padZero(number) {
    return number < 10 ? `0${number}` : number;
  }

  function handleGameOver() {
    stopClock();
    gameActive = false;
    checkGameEnd();
    engine.postMessage(`setoption name UCI_LimitStrength value false`);
  }

  function createBestMoveArrow() {
    bestMoveArrow = gsap.timeline({ paused: true });
    bestMoveArrow.set("#best-move-arrow", { opacity: 0 });
  }

  function animateBestMoveArrow(bestMove) {
    if (bestMoveArrow) {
      bestMoveArrow.kill(); // Stop any existing animation
    }

    const [fromSquare, toSquare] = bestMove.split("");
    const fromPos = $("#" + fromSquare).offset();
    const toPos = $("#" + toSquare).offset();

    gsap.set("#best-move-arrow", {
      x: fromPos.left + 25,
      y: fromPos.top + 25,
      opacity: 0,
    });

    bestMoveArrow = gsap.to("#best-move-arrow", {
      x: toPos.left + 25,
      y: toPos.top + 25,
      opacity: 1,
      duration: 0.5,
      ease: "power2.out",
      onComplete: () => {
        gsap.to("#best-move-arrow", {
          opacity: 0,
          duration: 0.3,
          delay: 0.5,
        });
      },
    });

    bestMoveArrow.play();
  }

  // Function to generate HTML for a move with an icon
  function getMoveHTMLWithIcon(move, index) {
    const pieceCode = move.piece.toUpperCase();
    let pieceIcon = "";

    switch (pieceCode) {
      case "P":
        pieceIcon = "♙";
        break; // Pawn
      case "N":
        pieceIcon = "♘";
        break; // Knight
      case "B":
        pieceIcon = "♗";
        break; // Bishop
      case "R":
        pieceIcon = "♖";
        break; // Rook
      case "Q":
        pieceIcon = "♕";
        break; // Queen
      case "K":
        pieceIcon = "♔";
        break; // King
      default:
        pieceIcon = move.piece; // Fallback
    }

    return `<span class="move" data-move-index="${index}">${pieceIcon} ${move.to.toLowerCase()}</span>`;
  }

  function reviewCurrentGame() {
    reviewProgress = 0;
    updateReviewProgressBar(0);
    moveClassifications = []; 

    classifyMovesInPGN().then(() => { // No need to pass pgn
      updateReviewProgressBar(100);

      // After classifying, display the moves on the review board:
      displayMovesOnReviewBoard();
    });
  }
 // *** Improved classifyMovesInPGN Function ***
 async function classifyMovesInPGN(depth) {
  let tempGame = new Chess();

  const moves = game.history({ verbose: true }); 
  console.log("Moves to classify:", moves);

  for (let i = 0; i < moves.length; i++) {
    currentEval = 0; 
    let evalDiff = 0;
    previousEval = 0; // You might want to initialize this to null for the first move

    const move = moves[i];
    console.log(`Classifying move ${i + 1}:`, move);

    tempGame.move(move); // Apply the move to the temporary game **ONLY ONCE**
    console.log("FEN after applying move:", tempGame.fen());

    if (i > 0) {
      previousEval = await calculateEvalForReview(tempGame.fen(), depth); 
      console.log("Previous evaluation:", previousEval);
      evalDiff = currentEval - previousEval; 
    }

    currentEval = await calculateEvalForReview(tempGame.fen(), depth); // Get evaluation **after** the move
    console.log("Current evaluation:", currentEval);
    console.log("Evaluation difference:", evalDiff);

    const classification = classifyMove(evalDiff, currentEval, move); 
    console.log("Classification:", classification);

    moveClassifications.push(classification);

    reviewProgress = ((i + 1) / moves.length) * 100;
    updateReviewProgressBar(reviewProgress);
  }
  console.log("Final move classifications:", moveClassifications);
}
  function updateReviewProgressBar(percentage) {
    $(".progress-bar").css("width", `${percentage}%`);
    $(".progress-bar").text(`${percentage.toFixed(0)}%`);
  }

  function displayMovesOnReviewBoard() {
    let tempGame = new Chess();
    tempGame.load_pgn(game.pgn());

    const moveListReview = $("#move-list-review");
    moveListReview.empty();
    let moveNumber = 1; 

    tempGame.history({ verbose: true }).forEach((move, index) => {
      const classification = moveClassifications[index];

      const moveText = `${moveNumber}. ${getMoveHTMLWithIcon(move, index)} ${classification ? `<span class="classification">(${classification})</span>` : ''}`;
      const listItem = $("<li>")
        .html(moveText)
        .addClass(index % 2 === 0 ? "even-move" : "odd-move")
        .on("click", () => {
          reviewBoard.position(tempGame.fen()); 
          $("#move-classification-text").text(classification || ""); 
          $("#opening-name-review").text(getOpeningName(tempGame.fen())); 
          updateEvalBarReview(calculateEvalForReview(tempGame.fen()));
        });

      moveListReview.append(listItem); 
      tempGame.move(move); 
      moveNumber++;
    });
  }

  function getOpeningName(fen) {
    const moveCount = game.history().length;

    if (moveCount < 19) {
      let matchedOpening = openings.find((opening) => {
        return opening.fen.split(" ")[0] === fen.split(" ")[0];
      });

      if (matchedOpening) {
        return matchedOpening.name;
      }
    }

    return "None"; 
  }

  function calculateEvalForReview(fen , reviewDepth) {
    engine.postMessage(`position fen ${fen}`);
    engine.postMessage(`go depth ${reviewDepth}`); 

    return new Promise((resolve) => {
      const tempEngineListener = function (event) {
        const message = event.data;
        if (message.includes("score")) {
          const evalScore = extractEvaluation(message); 
          resolve(evalScore);
          engine.removeEventListener("message", tempEngineListener);
        }
      };
      engine.addEventListener("message", tempEngineListener);
    });
  }

  function updateEvalBarReview(evalValue) {
    const evalBar = $("#eval-bar-review-inner");
    const evalText = $("#eval-text-review");
  
    if (typeof evalValue === "object" && evalValue.type === "mate") {
      // Handle mate evaluation:
      evalBar.css("width", "100%"); // Full bar for mate
      evalBar.css(
        "background-color",
        evalValue.value > 0 ? "#76c7c0" : "#c77676" // Green for White mate, Red for Black mate
      );
      let mateInMoves = Math.abs(evalValue.value);
      evalText.text(
        `Evaluation: Mate in ${mateInMoves} ${mateInMoves === 1 ? "move" : "moves"}`
      );
    } else {
      // Handle centipawn evaluation:
      const percentage = 50 + evalValue * 50;
      evalBar.css("width", `${percentage}%`);
      evalBar.css(
        "background-color",
        evalValue >= 0 ? "#76c7c0" : "#c77676"
      );
      evalText.text(`Evaluation: ${evalValue.toFixed(2)}`);
    }
  }
});
