/**
 * Phase 10 Game Engine — Final
 *
 * Browser-friendly ES module, independent of the user interface.
 *
 * Classic Phase 10 rules:
 * - 2–6 players
 * - 108-card deck: two each of numbers 1–12 in four colors,
 *   8 Wilds, and 4 Skips
 * - Each turn: draw, optionally lay down a phase, optionally hit,
 *   then discard or play a Skip
 *
 * V29 changes:
 * - A Skip must be played from the hand against a chosen player.
 * - A Skip cannot be picked up from the discard pile.
 * - A Skip cannot be discarded as an ordinary card.
 * - The Skip remains in front of its target until that player's
 *   skipped turn begins. It then moves to the discard pile.
 * - A player cannot be targeted by another Skip until they have
 *   received a normal turn.
 * - Multiple different players may be on Skip cooldown at once.
 * - Completed rounds remain intact while the score popup is shown.
 * - startNextRound() deals the next round only after confirmation.
 */

export const COLORS = ["red", "blue", "green", "yellow"];

export const PHASES = [
  [{ type: "set", count: 3 }, { type: "set", count: 3 }],
  [{ type: "set", count: 3 }, { type: "run", count: 4 }],
  [{ type: "set", count: 4 }, { type: "run", count: 4 }],
  [{ type: "run", count: 7 }],
  [{ type: "run", count: 8 }],
  [{ type: "run", count: 9 }],
  [{ type: "set", count: 4 }, { type: "set", count: 4 }],
  [{ type: "color", count: 7 }],
  [{ type: "set", count: 5 }, { type: "set", count: 2 }],
  [{ type: "set", count: 5 }, { type: "set", count: 3 }],
];

export class Phase10Error extends Error {
  constructor(message) {
    super(message);
    this.name = "Phase10Error";
  }
}

const clone = value => JSON.parse(JSON.stringify(value));

/* ---------------------------------------------------------
   DECK AND SCORING
--------------------------------------------------------- */

export function createDeck() {
  const deck = [];
  let id = 0;

  for (const color of COLORS) {
    for (let number = 1; number <= 12; number++) {
      for (let copy = 0; copy < 2; copy++) {
        deck.push({
          id: `c${id++}`,
          type: "number",
          color,
          number
        });
      }
    }
  }

  for (let i = 0; i < 8; i++) {
    deck.push({ id: `c${id++}`, type: "wild" });
  }

  for (let i = 0; i < 4; i++) {
    deck.push({ id: `c${id++}`, type: "skip" });
  }

  return deck;
}

export function shuffle(cards, rng = Math.random) {
  const result = [...cards];

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

export function scoreCard(card) {
  if (card.type === "wild") return 25;
  if (card.type === "skip") return 15;
  return card.number >= 10 ? 10 : 5;
}

export function scoreHand(hand) {
  return hand.reduce((total, card) => total + scoreCard(card), 0);
}

/* ---------------------------------------------------------
   PHASE VALIDATION
--------------------------------------------------------- */

function combinations(items, count) {
  const out = [];

  function walk(start, picked) {
    if (picked.length === count) {
      out.push(picked);
      return;
    }

    for (
      let i = start;
      i <= items.length - (count - picked.length);
      i++
    ) {
      walk(i + 1, [...picked, items[i]]);
    }
  }

  walk(0, []);
  return out;
}

function isValidSet(cards, count) {
  if (cards.length < count) return false;
  if (cards.some(card => card.type === "skip")) return false;

  const numbered = cards.filter(card => card.type === "number");

  if (!numbered.length) {
    return cards.every(card => card.type === "wild");
  }

  return numbered.every(
    card => card.number === numbered[0].number
  );
}

function isValidRun(cards, count) {
  const length = cards.length;

  if (
    length < count ||
    length > 12 ||
    cards.some(card => card.type === "skip")
  ) {
    return false;
  }

  const numbered = cards.filter(card => card.type === "number");
  const wildCount = cards.filter(card => card.type === "wild").length;

  if (numbered.length + wildCount !== length) return false;

  const values = numbered.map(card => card.number);

  if (new Set(values).size !== values.length) return false;

  // All natural cards must fit in one consecutive interval.
  // Wilds fill the remaining positions.
  for (let start = 1; start <= 13 - length; start++) {
    const allowed = new Set(
      Array.from({ length }, (_, i) => start + i)
    );

    if (values.every(number => allowed.has(number))) {
      return true;
    }
  }

  return false;
}

function isValidRunHit(existingCards, addedCard) {
  const all = [...existingCards, addedCard];
  const length = all.length;

  if (length > 12 || all.some(card => card.type === "skip")) {
    return false;
  }

  const numbered = all.filter(card => card.type === "number");
  const values = numbered.map(card => card.number);

  if (new Set(values).size !== values.length) return false;

  // A hit must extend an end of the run.
  // A Wild already on the table cannot be replaced by filling
  // a missing number in the middle.
  for (let start = 1; start <= 13 - length; start++) {
    const end = start + length - 1;

    const addedIsEndpoint =
      addedCard.type === "wild" ||
      addedCard.number === start ||
      addedCard.number === end;

    if (!addedIsEndpoint) continue;

    const allowed = new Set(
      Array.from({ length }, (_, i) => start + i)
    );

    if (values.every(number => allowed.has(number))) {
      return true;
    }
  }

  return false;
}

function isValidColor(cards, count) {
  if (
    cards.length !== count ||
    cards.some(card => card.type === "skip")
  ) {
    return false;
  }

  const colored = cards.filter(card => card.type === "number");

  if (!colored.length) return true;

  return colored.every(
    card => card.color === colored[0].color
  );
}

/**
 * Finds a legal grouping of the chosen cards for a phase.
 * Returns grouped card IDs or throws Phase10Error.
 */
export function validatePhase(cards, phaseNumber) {
  const phase = PHASES[phaseNumber - 1];

  if (!phase) {
    throw new Phase10Error(
      "Phase number must be between 1 and 10."
    );
  }

  const expected = phase.reduce(
    (sum, part) => sum + part.count,
    0
  );

  if (cards.length < expected) {
    throw new Phase10Error(
      `Phase ${phaseNumber} requires at least ${expected} cards.`
    );
  }

  if (new Set(cards.map(card => card.id)).size !== cards.length) {
    throw new Phase10Error("A card cannot be used more than once.");
  }

  const assign = (partIndex, remaining, groups) => {
    if (partIndex === phase.length) {
      return remaining.length === 0 ? groups : null;
    }

    const part = phase[partIndex];

    const sizes = part.type === "color"
      ? [part.count]
      : Array.from(
          {
            length: Math.max(
              0,
              remaining.length - part.count + 1
            )
          },
          (_, i) => part.count + i
        );

    for (const size of sizes) {
      if (size > remaining.length) continue;

      for (const group of combinations(remaining, size)) {
        let valid = false;

        if (part.type === "set") {
          valid = isValidSet(group, part.count);
        }

        if (part.type === "run") {
          valid = isValidRun(group, part.count);
        }

        if (part.type === "color") {
          valid = isValidColor(group, part.count);
        }

        if (!valid) continue;

        const used = new Set(group.map(card => card.id));
        const rest = remaining.filter(
          card => !used.has(card.id)
        );

        const result = assign(
          partIndex + 1,
          rest,
          [...groups, group]
        );

        if (result) return result;
      }
    }

    return null;
  };

  const grouping = assign(0, cards, []);

  if (!grouping) {
    throw new Phase10Error(
      `Those cards do not make a valid Phase ${phaseNumber}.`
    );
  }

  return grouping.map(
    group => group.map(card => card.id)
  );
}

/* ---------------------------------------------------------
   INTERNAL HELPERS
--------------------------------------------------------- */

function currentPlayer(state) {
  return state.players[state.currentPlayerIndex];
}

function findPlayer(state, playerId) {
  const player = state.players.find(
    candidate => candidate.id === playerId
  );

  if (!player) {
    throw new Phase10Error("Player not found.");
  }

  return player;
}

function removeCardById(hand, cardId) {
  const index = hand.findIndex(card => card.id === cardId);

  if (index < 0) {
    throw new Phase10Error("That card is not in your hand.");
  }

  return hand.splice(index, 1)[0];
}

function drawFromStock(state) {
  if (state.drawPile.length === 0) {
    if (state.discardPile.length <= 1) {
      throw new Phase10Error("No cards are available to draw.");
    }

    const topDiscard = state.discardPile.pop();

    state.drawPile = shuffle(
      state.discardPile,
      state.rng
    );

    state.discardPile = [topDiscard];
  }

  return state.drawPile.pop();
}

function assertCurrent(state, playerId) {
  if (state.status !== "playing") {
    throw new Phase10Error("The game is over.");
  }

  if (currentPlayer(state).id !== playerId) {
    throw new Phase10Error("It is not that player's turn.");
  }
}

function orderRunCards(cards) {
  const count = cards.length;
  const numbered = cards.filter(
    card => card.type === "number"
  );

  // Find a legal run interval and place Wilds in vacant positions.
  for (let start = 1; start <= 13 - count; start++) {
    const positions = new Map();
    let valid = true;

    for (const card of numbered) {
      const position = card.number - start;

      if (
        position < 0 ||
        position >= count ||
        positions.has(position)
      ) {
        valid = false;
        break;
      }

      positions.set(position, card);
    }

    if (!valid) continue;

    const wilds = cards.filter(
      card => card.type === "wild"
    );

    let wildIndex = 0;
    const ordered = [];

    for (let i = 0; i < count; i++) {
      if (positions.has(i)) {
        ordered.push(positions.get(i));
      } else if (wildIndex < wilds.length) {
        ordered.push(wilds[wildIndex++]);
      } else {
        valid = false;
        break;
      }
    }

    if (valid && ordered.length === count) {
      return ordered;
    }
  }

  return cards;
}

/* ---------------------------------------------------------
   CREATE GAME
--------------------------------------------------------- */

export function createGame(playerSpecs, options = {}) {
  if (
    !Array.isArray(playerSpecs) ||
    playerSpecs.length < 2 ||
    playerSpecs.length > 6
  ) {
    throw new Phase10Error("Phase 10 needs 2–6 players.");
  }

  if (
    new Set(playerSpecs.map(player => player.id)).size !==
    playerSpecs.length
  ) {
    throw new Phase10Error("Player IDs must be unique.");
  }

  const state = {
    version: 29,
    status: "playing",
    roundNumber: 1,
    dealerIndex: 0,
    currentPlayerIndex: 1 % playerSpecs.length,
    turnStage: "draw",

    players: playerSpecs.map((player, index) => ({
      id: player.id,
      name: player.name ?? `Player ${index + 1}`,
      kind: player.kind ?? "human",
      phase: 1,
      hand: [],
      laidPhase: false,
      tableau: [],
      score: 0,
      skipped: false,
      pendingSkipCard: null
    })),

    drawPile: [],
    discardPile: [],
    lastAction: null,
    winnerId: null,

    // V29: Players remain on Skip cooldown until they receive
    // a normal turn. The existing property name is retained
    // for compatibility with the V28 interface.
    pendingNextRound: false,
    skipTargetsUsed: [],

    rng: options.rng ?? Math.random
  };

  const deck = shuffle(createDeck(), state.rng);

  for (let n = 0; n < 10; n++) {
    for (const player of state.players) {
      player.hand.push(deck.pop());
    }
  }

  state.drawPile = deck;

  const openingDiscard = state.drawPile.pop();
  state.discardPile.push(openingDiscard);

  // Dealer is player 0. Play begins to the dealer's left.
  state.currentPlayerIndex =
    (state.dealerIndex + 1) % state.players.length;

  if (openingDiscard.type === "skip") {
    const skippedPlayer = currentPlayer(state);

    // An opening Skip is already on the discard pile.
    // Its target is placed on cooldown until their next
    // normal turn.
    skippedPlayer.skipped = false;
    state.skipTargetsUsed.push(skippedPlayer.id);

    state.currentPlayerIndex =
      (state.currentPlayerIndex + 1) % state.players.length;

    state.lastAction = {
      type: "openingSkip",
      skippedPlayerId: skippedPlayer.id,
      dealerId: state.players[state.dealerIndex].id,
      openingDiscardId: openingDiscard.id
    };
  } else {
    state.lastAction = {
      type: "roundStart",
      dealerId: state.players[state.dealerIndex].id,
      firstPlayerId: currentPlayer(state).id,
      openingDiscardId: openingDiscard.id
    };
  }

  return state;
}

/* ---------------------------------------------------------
   PUBLIC STATE
--------------------------------------------------------- */

export function getPublicState(state, viewerPlayerId = null) {
  return {
    version: state.version,
    status: state.status,
    roundNumber: state.roundNumber,
    dealerIndex: state.dealerIndex,
    dealerId: state.players[state.dealerIndex]?.id ?? null,
    currentPlayerIndex: state.currentPlayerIndex,
    currentPlayerId: currentPlayer(state)?.id ?? null,
    turnStage: state.turnStage,

    players: state.players.map(player => ({
      id: player.id,
      name: player.name,
      kind: player.kind,
      phase: player.phase,
      handCount: player.hand.length,
      hand: player.id === viewerPlayerId
        ? clone(player.hand)
        : undefined,
      laidPhase: player.laidPhase,
      tableau: clone(player.tableau ?? []),
      score: player.score,
      skipped: player.skipped,
      pendingSkipCard: player.pendingSkipCard
        ? clone(player.pendingSkipCard)
        : null
    })),

    drawPileCount: state.drawPile.length,

    discardTop: state.discardPile.length
      ? clone(state.discardPile.at(-1))
      : null,

    lastAction: clone(state.lastAction),
    winnerId: state.winnerId,
    pendingNextRound: state.pendingNextRound,
    skipTargetsUsed: [...state.skipTargetsUsed]
  };
}

/* ---------------------------------------------------------
   DRAW
--------------------------------------------------------- */

export function drawCard(state, playerId, source = "draw") {
  assertCurrent(state, playerId);

  if (state.pendingNextRound) {
    throw new Phase10Error(
      "The completed round must be continued before playing."
    );
  }

  if (state.turnStage !== "draw") {
    throw new Phase10Error("You have already drawn this turn.");
  }

  const player = currentPlayer(state);
  let card;

  if (source === "draw") {
    card = drawFromStock(state);
  } else if (source === "discard") {
    if (state.discardPile.length === 0) {
      throw new Phase10Error("The discard pile is empty.");
    }

    const top = state.discardPile.at(-1);

    if (top.type === "skip") {
      throw new Phase10Error(
        "A Skip card cannot be picked up from the discard pile."
      );
    }

    card = state.discardPile.pop();
  } else {
    throw new Phase10Error(
      "Draw source must be 'draw' or 'discard'."
    );
  }

  player.hand.push(card);
  state.turnStage = "action";

  state.lastAction = {
    type: "draw",
    playerId,
    source,
    cardId: card.id
  };

  return clone(card);
}

/* ---------------------------------------------------------
   LAY DOWN A PHASE
--------------------------------------------------------- */

export function layDownPhase(state, playerId, cardIds) {
  assertCurrent(state, playerId);

  if (state.turnStage !== "action") {
    throw new Phase10Error(
      "Draw before laying down a phase."
    );
  }

  const player = currentPlayer(state);

  if (player.laidPhase) {
    throw new Phase10Error(
      "You have already laid down this round's phase."
    );
  }

  if (!Array.isArray(cardIds) || cardIds.length === 0) {
    throw new Phase10Error(
      "Select the cards for your phase."
    );
  }

  // Keep at least one card for the required end-of-turn play.
  if (cardIds.length >= player.hand.length) {
    throw new Phase10Error(
      "You must keep at least one card in your hand to discard after laying down your phase."
    );
  }

  const cards = cardIds.map(id => {
    const card = player.hand.find(
      candidate => candidate.id === id
    );

    if (!card) {
      throw new Phase10Error(
        `Card ${id} is not in your hand.`
      );
    }

    return card;
  });

  const groups = validatePhase(cards, player.phase);

  const used = new Set(cardIds);

  player.hand = player.hand.filter(
    card => !used.has(card.id)
  );

  player.laidPhase = true;
  player.tableau = player.tableau ?? [];

  const phaseDefinition = PHASES[player.phase - 1];

  player.tableau.push(
    ...groups.map((groupIds, index) => {
      const groupCards = groupIds.map(
        id => cards.find(card => card.id === id)
      );

      return {
        type: phaseDefinition[index].type,
        cards: phaseDefinition[index].type === "run"
          ? orderRunCards(groupCards)
          : groupCards
      };
    })
  );

  state.lastAction = {
    type: "layPhase",
    playerId,
    phase: player.phase,
    groups
  };

  return clone(groups);
}

/* ---------------------------------------------------------
   HIT ON A LAID PHASE
--------------------------------------------------------- */

export function hitOnTable(
  state,
  playerId,
  targetPlayerId,
  targetGroupIndex,
  cardId
) {
  assertCurrent(state, playerId);

  if (state.turnStage !== "action") {
    throw new Phase10Error("Draw before hitting.");
  }

  const player = currentPlayer(state);

  if (!player.laidPhase) {
    throw new Phase10Error(
      "You must lay down your own phase before hitting."
    );
  }

  const target = findPlayer(state, targetPlayerId);

  if (
    !target.laidPhase ||
    !target.tableau?.[targetGroupIndex]
  ) {
    throw new Phase10Error(
      "That player has no eligible group on the table."
    );
  }

  const card = player.hand.find(
    candidate => candidate.id === cardId
  );

  if (!card) {
    throw new Phase10Error("That card is not in your hand.");
  }

  const targetGroup = target.tableau[targetGroupIndex];
  const group = targetGroup.cards;
  const expanded = [...group, card];

  const originalType = targetGroup.type;
  const requiredCount = group.length + 1;

  let valid = false;

  if (originalType === "set") {
    valid = isValidSet(expanded, group.length);
  }

  if (originalType === "run") {
    valid = isValidRunHit(group, card);
  }

  if (originalType === "color") {
    valid = isValidColor(expanded, requiredCount);
  }

  if (!valid) {
    throw new Phase10Error(
      "That card cannot be added to this group."
    );
  }

  player.hand = player.hand.filter(
    candidate => candidate.id !== cardId
  );

  group.push(card);

  state.lastAction = {
    type: "hit",
    playerId,
    targetPlayerId,
    targetGroupIndex,
    cardId
  };
}

/* ---------------------------------------------------------
   DISCARD
--------------------------------------------------------- */

export function discardCard(state, playerId, cardId) {
  assertCurrent(state, playerId);

  if (state.turnStage !== "action") {
    throw new Phase10Error("Draw before discarding.");
  }

  const player = currentPlayer(state);
  const card = player.hand.find(
    candidate => candidate.id === cardId
  );

  if (!card) {
    throw new Phase10Error("That card is not in your hand.");
  }

  if (card.type === "skip") {
    throw new Phase10Error(
      "A Skip must be played on a chosen player, not discarded."
    );
  }

  removeCardById(player.hand, cardId);
  state.discardPile.push(card);

  state.lastAction = {
    type: "discard",
    playerId,
    cardId
  };

  if (player.hand.length === 0) {
    finishRound(state, player.id);
  } else {
    advanceTurn(state);
  }

  return getPublicState(state, playerId);
}

/* ---------------------------------------------------------
   SKIP PLAY
--------------------------------------------------------- */

export function playSkip(
  state,
  playerId,
  targetPlayerId,
  cardId
) {
  assertCurrent(state, playerId);

  if (state.turnStage !== "action") {
    throw new Phase10Error(
      "Draw before playing a Skip card."
    );
  }

  const player = currentPlayer(state);

  const card = player.hand.find(
    candidate => candidate.id === cardId
  );

  if (!card || card.type !== "skip") {
    throw new Phase10Error("Choose a Skip card.");
  }

  if (targetPlayerId === playerId) {
    throw new Phase10Error("You cannot skip yourself.");
  }

  const target = findPlayer(state, targetPlayerId);

  if ((state.skipTargetsUsed || []).includes(targetPlayerId)) {
    throw new Phase10Error(
      "That player cannot be targeted again until they have had a normal turn."
    );
  }

  // Remove the Skip from the player's hand.
  // It does NOT go to the discard pile yet.
  player.hand = player.hand.filter(
    candidate => candidate.id !== cardId
  );

  // Place the Skip in front of its target.
  target.pendingSkipCard = card;
  target.skipped = true;

  // Add the target to cooldown. They become eligible again
  // only when advanceTurn gives them a normal turn.
  if (!state.skipTargetsUsed) state.skipTargetsUsed = [];
  state.skipTargetsUsed.push(targetPlayerId);

  state.lastAction = {
    type: "playSkip",
    playerId,
    targetPlayerId,
    cardId
  };

  // Playing a Skip ends the current player's turn.
  if (player.hand.length === 0) {
    finishRound(state, player.id);
  } else {
    advanceTurn(state);
  }

  return getPublicState(state, playerId);
}

/* ---------------------------------------------------------
   TURN ADVANCEMENT
--------------------------------------------------------- */

function advanceTurn(state) {
  const playerCount = state.players.length;
  let next = state.currentPlayerIndex;

  // Move clockwise until an eligible player is found.
  // A player with a pending Skip loses this turn.
  for (let attempts = 0; attempts < playerCount; attempts++) {
    next = (next + 1) % playerCount;

    const player = state.players[next];

    if (player.skipped) {
      const skipCard = player.pendingSkipCard;

      // The Skip card moves to the discard pile at the start
      // of the target player's missed turn.
      if (skipCard) {
        state.discardPile.push(skipCard);
      }

      player.pendingSkipCard = null;
      player.skipped = false;

      // IMPORTANT: Keep this player on cooldown.
      // They have not yet received a normal turn.
      state.lastAction = {
        type: "skipTurn",
        playerId: player.id,
        skipCardId: skipCard?.id ?? null
      };

      continue;
    }

    // This player is receiving a normal turn.
    // Their previous Skip cooldown now expires.
    state.skipTargetsUsed = (state.skipTargetsUsed || [])
      .filter(id => id !== player.id);

    state.currentPlayerIndex = next;
    state.turnStage = "draw";
    return;
  }

  // This fallback handles the unusual case where every other
  // player has been skipped.
  state.currentPlayerIndex = next;
  state.turnStage = "draw";
}

/* ---------------------------------------------------------
   ROUND END
--------------------------------------------------------- */

function finishRound(state, finisherId) {
  // Score every remaining hand before changing or clearing anything.
  const roundScores = Object.fromEntries(
    state.players.map(player => [
      player.id,
      scoreHand(player.hand)
    ])
  );

  for (const player of state.players) {
    player.score =
      Number(player.score || 0) + roundScores[player.id];
  }

  const finisher = findPlayer(state, finisherId);

  state.lastAction = {
    type: "roundEnd",
    finisherId,
    roundScores,
    totals: Object.fromEntries(
      state.players.map(player => [
        player.id,
        player.score
      ])
    )
  };

  if (finisher.phase === 10) {
    state.status = "finished";
    state.winnerId = finisher.id;
    state.pendingNextRound = false;
    return;
  }

  // V29: Do not clear hands, tableau, or change the round here.
  // The completed round stays visible while the score popup is shown.
  state.pendingNextRound = true;
}

/* ---------------------------------------------------------
   START NEXT ROUND
--------------------------------------------------------- */

/**
 * Called by the interface after the user confirms the
 * round-end score popup.
 */
export function startNextRound(state) {
  if (state.status !== "playing") {
    throw new Phase10Error(
      "The game has finished. No next round is available."
    );
  }

  if (!state.pendingNextRound) {
    throw new Phase10Error(
      "There is no completed round waiting to be continued."
    );
  }

  // Players who laid down their phase advance.
  // All players then receive fresh hands and a clean tableau.
  for (const player of state.players) {
    if (player.laidPhase) {
      player.phase = Math.min(10, player.phase + 1);
    }

    player.hand = [];
    player.laidPhase = false;
    player.tableau = [];
    player.skipped = false;
    player.pendingSkipCard = null;
  }

  state.roundNumber += 1;

  // Rotate the dealer clockwise.
  state.dealerIndex =
    (Number(state.dealerIndex || 0) + 1) %
    state.players.length;

  state.currentPlayerIndex =
    (state.dealerIndex + 1) % state.players.length;

  // Reset per-round Skip cooldowns.
  state.skipTargetsUsed = [];

  // Create and deal a fresh deck.
  state.drawPile = shuffle(
    createDeck(),
    state.rng
  );

  state.discardPile = [];

  for (let n = 0; n < 10; n++) {
    for (const player of state.players) {
      player.hand.push(state.drawPile.pop());
    }
  }

  const openingDiscard = state.drawPile.pop();
  state.discardPile.push(openingDiscard);

  let openingSkip = null;

  if (openingDiscard.type === "skip") {
    const skippedPlayer = currentPlayer(state);

    // Opening Skip: target is on cooldown until their next
    // normal turn, even though the Skip is already discarded.
    state.skipTargetsUsed.push(skippedPlayer.id);

    openingSkip = {
      skippedPlayerId: skippedPlayer.id
    };

    state.currentPlayerIndex =
      (state.currentPlayerIndex + 1) %
      state.players.length;
  }

  state.pendingNextRound = false;
  state.turnStage = "draw";

  state.lastAction = {
    type: "roundStart",
    roundNumber: state.roundNumber,
    dealerId: state.players[state.dealerIndex].id,
    firstPlayerId: currentPlayer(state).id,
    openingDiscardId: openingDiscard.id,
    openingSkip
  };

  return state;
}

/* ---------------------------------------------------------
   PHASE DESCRIPTION
--------------------------------------------------------- */

export function getPhaseDescription(phaseNumber) {
  const phase = PHASES[phaseNumber - 1];

  if (!phase) {
    throw new Phase10Error(
      "Phase number must be between 1 and 10."
    );
  }

  return phase.map(({ type, count }) => {
    if (type === "set") {
      return `a set of ${count}`;
    }

    if (type === "run") {
      return `a run of ${count}`;
    }

    return `${count} cards of one color`;
  }).join(" + ");
}
