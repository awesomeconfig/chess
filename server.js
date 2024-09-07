const express = require("express");
const fs = require("fs");
const readline = require("readline");

const app = express();
const port = 3000;
const pgnFilePath = "gametest.pgn";

app.use(express.static(__dirname));

let gamesData = [];

async function loadGames() {
  console.log("Loading PGN data...");
  const startTime = performance.now();
  gamesData = await parsePgnFile(pgnFilePath);
  const endTime = performance.now();
  console.log(
    `Loaded ${gamesData.length} games in ${
      endTime - startTime
    } milliseconds.`
  );
}

loadGames();

function isGameMatch(gameData, player1, player2, result) {
  if (result && gameData.Result !== result) {
    return false;
  }

  const whitePlayer = gameData.White?.toLowerCase();
  const blackPlayer = gameData.Black?.toLowerCase();

  if (
    player1 &&
    !(
      (whitePlayer && whitePlayer.includes(player1)) ||
      (blackPlayer && blackPlayer.includes(player1))
    )
  ) {
    return false;
  }

  if (
    player2 &&
    !(
      (whitePlayer && whitePlayer.includes(player2)) ||
      (blackPlayer && blackPlayer.includes(player2))
    )
  ) {
    return false;
  }

  return true;
}

app.get("/search", async (req, res) => {
  const player1 = req.query.player1?.toLowerCase() || null;
  const player2 = req.query.player2?.toLowerCase() || null;
  const result = req.query.result || null;
  const maxResults = parseInt(req.query.maxResults, 10) || 10;

  console.log("Received search request:", {
    player1,
    player2,
    result,
    maxResults,
  });

  try {
    const startTime = performance.now();

    const matchingGames = gamesData.filter((gameData) =>
      isGameMatch(gameData, player1, player2, result)
    );

    const limitedResults = matchingGames.slice(0, maxResults);

    const endTime = performance.now();

    console.log(
      `Search complete. Found ${limitedResults.length} matches in ${
        endTime - startTime
      } milliseconds`
    );

    res.json(limitedResults);
  } catch (error) {
    console.error("Error during search:", error);
    res.status(500).json({ error: "An error occurred during the search." });
  }
});

function getMovesListFromPGN(pgnString) {
  if (!pgnString) return [];

  const moves = pgnString
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(
      (token) =>
        !token.match(/^(?:\d+\.|\*|(?:1|0|1\/2)-(?:1|0|1\/2))$/)
    );

  return moves;
}

async function parsePgnFile(filePath) {
  const games = [];
  let currentGame = "";

  const readStream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({
    input: readStream,
    crlfDelay: Infinity, // Handle line breaks correctly
  });

  for await (const line of rl) {
    if (line.trim() === "") {
      if (currentGame) {
        games.push(parseGame(currentGame));
        currentGame = "";
      }
    } else {
      currentGame += line + "\n";
    }
  }

  if (currentGame) {
    games.push(parseGame(currentGame));
  }

  rl.close();
  readStream.close();
  return games;
}

function parseGame(gameString) {
  const gameData = {};
  const lines = gameString.split("\n");
  let pgnMoves = "";

  lines.forEach((line) => {
    // If the line is not a header line (starts with '['), consider it part of the moves
    if (!line.trim().startsWith("[")) {
      pgnMoves += line.trim() + " ";
    } else {
      // Extract header information
      const match = line.match(/\[(.*?)\s+"(.*?)"\]/);
      if (match) {
        const key = match[1];
        const value = match[2];
        gameData[key] = value;
      }
    }
  });

  gameData.pgn = pgnMoves.trim();
  // Add movesList to gameData
  gameData.movesList = getMovesListFromPGN(gameData.pgn);

  return gameData;
}

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});