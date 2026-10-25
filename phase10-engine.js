/**
 * Phase 10 Game Engine — MVP
 * Browser-friendly ES module, independent of the user interface.
 *
 * Classic Phase 10 rules:
 * - 2–6 players
 * - 108-card deck: two each of numbers 1–12 in four colors, 8 Wilds, 4 Skips
 * - Each turn: draw, optionally lay down phase, optionally hit, discard
 *
 * This is the rules/state foundation. Computer strategy and UI are separate modules.
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

const clone = (value) => JSON.parse(JSON.stringify(value));
const randomIndex = (max) => Math.floor(Math.random() * max);

export function createDeck() {
  const deck = [];
  let id = 0;

  for (const color of COLORS) {
    for (let number = 1; number <= 12; number++) {
      for (let copy = 0; copy < 2; copy++) {
        deck.push({ id: `c${id++}`, type: "number", color, number });
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

function combinations(items, count) {
  const out = [];
  function walk(start, picked) {
    if (picked.length === count) {
      out.push(picked);
      return;
    }
    for (let i = start; i <= items.length - (count - picked.length); i++) {
      walk(i + 1, [...picked, items[i]]);
    }
  }
  walk(0, []);
  return out;
}

function isValidSet(cards, count) {
  if (cards.length < count) return false;
  const numbered = cards.filter((c) => c.type === "number");
  if (cards.some((c) => c.type === "skip")) return false;
  if (!numbered.length) return cards.every((c) => c.type === "wild");
  return numbered.every((c) => c.number === numbered[0].number);
}

function isValidRun(cards, count) {
  const length = cards.length;
  if (length < count || length > 12 || cards.some((c) => c.type === "skip")) return false;
  // Duplicate natural numbers cannot occupy the same position in a run.
  const numbered = cards.filter((c) => c.type === "number");
  const wildCount = cards.filter((c) => c.type === "wild").length;
  if (numbered.length + wildCount !== length) return false;
  const values = numbered.map((c) => c.number);
  if (new Set(values).size !== values.length) return false;

  // All natural cards must fit in one consecutive interval; Wilds fill gaps.
  for (let start = 1; start <= 13 - length; start++) {
    const allowed = new Set(Array.from({ length }, (_, i) => start + i));
    if (values.every((n) => allowed.has(n))) return true;
  }
  return false;
}

function isValidRunHit(existingCards, addedCard) {
  const all = [...existingCards, addedCard];
  const length = all.length;
  if (length > 12 || all.some((c) => c.type === "skip")) return false;
  const numbered = all.filter((c) => c.type === "number");
  const values = numbered.map((c) => c.number);
  if (new Set(values).size !== values.length) return false;
  // A hit must extend one end of the run. A Wild already on the table cannot
  // be replaced by filling the number it represents in the middle of the run.
  for (let start = 1; start <= 13 - length; start++) {
    const end = start + length - 1;
    const addedIsEndpoint = addedCard.type === "wild" || addedCard.number === start || addedCard.number === end;
    if (!addedIsEndpoint) continue;
    const allowed = new Set(Array.from({ length }, (_, i) => start + i));
    if (values.every((n) => allowed.has(n))) return true;
  }
  return false;
}

function isValidColor(cards, count) {
  if (cards.length !== count || cards.some((c) => c.type === "skip")) return false;
  const colored = cards.filter((c) => c.type === "number");
  if (colored.length === 0) return true;
  return colored.every((c) => c.color === colored[0].color);
}

/**
 * Finds a legal grouping of the chosen cards for the player's current phase.
 * `cardIds` must identify exactly the cards the player wants to lay down.
 * Returns grouped card IDs when valid; otherwise throws Phase10Error.
 */
export function validatePhase(cards, phaseNumber) {
  const phase = PHASES[phaseNumber - 1];
  if (!phase) throw new Phase10Error("Phase number must be between 1 and 10.");

  const expected = phase.reduce((sum, part) => sum + part.count, 0);
  if (cards.length < expected) {
    throw new Phase10Error(`Phase ${phaseNumber} requires at least ${expected} cards.`);
  }
  if (new Set(cards.map((c) => c.id)).size !== cards.length) {
    throw new Phase10Error("A card cannot be used more than once.");
  }

  const assign = (partIndex, remaining, groups) => {
    if (partIndex === phase.length) return remaining.length === 0 ? groups : null;
    const part = phase[partIndex];
    const sizes = part.type === "color"
      ? [part.count]
      : Array.from({ length: Math.max(0, remaining.length - part.count + 1) }, (_, i) => part.count + i);
    for (const size of sizes) {
      if (size > remaining.length) continue;
      for (const group of combinations(remaining, size)) {
        let valid = false;
        if (part.type === "set") valid = isValidSet(group, part.count);
        if (part.type === "run") valid = isValidRun(group, part.count);
        if (part.type === "color") valid = isValidColor(group, part.count);
        if (!valid) continue;

      const used = new Set(group.map((c) => c.id));
      const rest = remaining.filter((c) => !used.has(c.id));
        const result = assign(partIndex + 1, rest, [...groups, group]);
        if (result) return result;
      }
    }
    return null;
  };

  const grouping = assign(0, cards, []);
  if (!grouping) {
    throw new Phase10Error(`Those cards do not make a valid Phase ${phaseNumber}.`);
  }
  return grouping.map((group) => group.map((card) => card.id));
}

function drawFromStock(state) {
  if (state.drawPile.length === 0) {
    if (state.discardPile.length <= 1) {
      throw new Phase10Error("No cards are available to draw.");
    }
    const topDiscard = state.discardPile.pop();
    state.drawPile = shuffle(state.discardPile);
    state.discardPile = [topDiscard];
  }
  return state.drawPile.pop();
}

function currentPlayer(state) {
  return state.players[state.currentPlayerIndex];
}

function removeCardById(hand, cardId) {
  const index = hand.findIndex((card) => card.id === cardId);
  if (index < 0) throw new Phase10Error("That card is not in your hand.");
  return hand.splice(index, 1)[0];
}

function findPlayer(state, playerId) {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) throw new Phase10Error("Player not found.");
  return player;
}

export function createGame(playerSpecs, options = {}) {
  if (!Array.isArray(playerSpecs) || playerSpecs.length < 2 || playerSpecs.length > 6) {
    throw new Phase10Error("Phase 10 needs 2–6 players.");
  }
  if (new Set(playerSpecs.map((p) => p.id)).size !== playerSpecs.length) {
    throw new Phase10Error("Player IDs must be unique.");
  }

  const state = {
    version: 1,
    status: "playing",
    roundNumber: 1,
    currentPlayerIndex: 0,
    turnStage: "draw",
    players: playerSpecs.map((p, index) => ({
      id: p.id,
      name: p.name ?? `Player ${index + 1}`,
      kind: p.kind ?? "human", // "human" or "computer"
      phase: 1,
      hand: [],
      laidPhase: false,
      score: 0,
      skipped: false,
    })),
    drawPile: [],
    discardPile: [],
    lastAction: null,
    winnerId: null,
    rng: options.rng ?? Math.random,
  };

  const deck = shuffle(createDeck(), state.rng);
  for (let n = 0; n < 10; n++) {
    for (const player of state.players) player.hand.push(deck.pop());
  }
  state.drawPile = deck;
  state.discardPile.push(state.drawPile.pop());
  return state;
}

export function getPublicState(state, viewerPlayerId = null) {
  return {
    version: state.version,
    status: state.status,
    roundNumber: state.roundNumber,
    currentPlayerIndex: state.currentPlayerIndex,
    currentPlayerId: currentPlayer(state)?.id ?? null,
    turnStage: state.turnStage,
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      kind: p.kind,
      phase: p.phase,
      handCount: p.hand.length,
      hand: p.id === viewerPlayerId ? clone(p.hand) : undefined,
      laidPhase: p.laidPhase,
      score: p.score,
      skipped: p.skipped,
    })),
    drawPileCount: state.drawPile.length,
    discardTop: state.discardPile.at(-1) ? clone(state.discardPile.at(-1)) : null,
    lastAction: clone(state.lastAction),
    winnerId: state.winnerId,
  };
}

function assertCurrent(state, playerId) {
  if (state.status !== "playing") throw new Phase10Error("The game is over.");
  if (currentPlayer(state).id !== playerId) throw new Phase10Error("It is not that player's turn.");
}

export function drawCard(state, playerId, source = "draw") {
  assertCurrent(state, playerId);
  if (state.turnStage !== "draw") throw new Phase10Error("You have already drawn this turn.");
  const player = currentPlayer(state);
  let card;
  if (source === "draw") {
    card = drawFromStock(state);
  } else if (source === "discard") {
    if (state.discardPile.length === 0) throw new Phase10Error("The discard pile is empty.");
    card = state.discardPile.pop();
  } else {
    throw new Phase10Error("Draw source must be 'draw' or 'discard'.");
  }
  player.hand.push(card);
  state.turnStage = "action";
  state.lastAction = { type: "draw", playerId, source, cardId: card.id };
  return clone(card);
}

export function layDownPhase(state, playerId, cardIds) {
  assertCurrent(state, playerId);
  if (state.turnStage !== "action") throw new Phase10Error("Draw before laying down a phase.");
  const player = currentPlayer(state);
  if (player.laidPhase) throw new Phase10Error("You have already laid down this round's phase.");
  const cards = cardIds.map((id) => {
    const card = player.hand.find((c) => c.id === id);
    if (!card) throw new Phase10Error(`Card ${id} is not in your hand.`);
    return card;
  });
  const groups = validatePhase(cards, player.phase);

  const used = new Set(cardIds);
  player.hand = player.hand.filter((card) => !used.has(card.id));
  player.laidPhase = true;
  player.tableau = player.tableau ?? [];
  const phaseDefinition = PHASES[player.phase - 1];
  player.tableau.push(...groups.map((groupIds, index) => ({
    type: phaseDefinition[index].type,
    cards: groupIds.map((id) => cards.find((c) => c.id === id)),
  })));
  state.lastAction = { type: "layPhase", playerId, phase: player.phase, groups };
  return clone(groups);
}

export function hitOnTable(state, playerId, targetPlayerId, targetGroupIndex, cardId) {
  assertCurrent(state, playerId);
  if (state.turnStage !== "action") throw new Phase10Error("Draw before hitting.");
  const player = currentPlayer(state);
  if (!player.laidPhase) throw new Phase10Error("You must lay down your own phase before hitting.");
  const target = findPlayer(state, targetPlayerId);
  if (!target.laidPhase || !target.tableau?.[targetGroupIndex]) {
    throw new Phase10Error("That player has no eligible group on the table.");
  }
  const card = player.hand.find((c) => c.id === cardId);
  if (!card) throw new Phase10Error("That card is not in your hand.");
  const targetGroup = target.tableau[targetGroupIndex];
  const group = targetGroup.cards;
  const expanded = [...group, card];

  const originalType = targetGroup.type;
  const requiredCount = group.length + 1;
  let valid = false;
  if (originalType === "set") valid = isValidSet(expanded, group.length);
  if (originalType === "run") valid = isValidRunHit(group, card);
  if (originalType === "color") valid = isValidColor(expanded, requiredCount);
  if (!valid) throw new Phase10Error("That card cannot be added to this group.");

  player.hand = player.hand.filter((c) => c.id !== cardId);
  group.push(card);
  state.lastAction = { type: "hit", playerId, targetPlayerId, targetGroupIndex, cardId };
}

function inferGroupType(group, phaseNumber) {
  const definition = PHASES[phaseNumber - 1];
  const groupIndex = group._phaseGroupIndex;
  if (Number.isInteger(groupIndex) && definition[groupIndex]) return definition[groupIndex].type;
  // Store type at lay-down time in newer state; this fallback supports older states.
  if (group.some((c) => c.type === "number") && group.every((c) => c.type !== "skip")) {
    const numbers = group.filter((c) => c.type === "number").map((c) => c.number);
    if (numbers.length && numbers.every((n) => n === numbers[0])) return "set";
    const colors = group.filter((c) => c.type === "number").map((c) => c.color);
    if (colors.length && colors.every((c) => c === colors[0]) && group.length >= 7) return "color";
    return "run";
  }
  return "set";
}

export function discardCard(state, playerId, cardId) {
  assertCurrent(state, playerId);
  if (state.turnStage !== "action") throw new Phase10Error("Draw before discarding.");
  const player = currentPlayer(state);
  const card = removeCardById(player.hand, cardId);
  state.discardPile.push(card);
  state.lastAction = { type: "discard", playerId, cardId };

  if (player.hand.length === 0) {
    finishRound(state, player.id);
  } else {
    advanceTurn(state);
  }
  return getPublicState(state, playerId);
}

function advanceTurn(state) {
  let next = state.currentPlayerIndex;
  for (let attempts = 0; attempts < state.players.length; attempts++) {
    next = (next + 1) % state.players.length;
    const player = state.players[next];
    if (player.skipped) {
      player.skipped = false;
      state.lastAction = { type: "skip", playerId: player.id };
      continue;
    }
    state.currentPlayerIndex = next;
    state.turnStage = "draw";
    return;
  }
  state.currentPlayerIndex = next;
  state.turnStage = "draw";
}

export function playSkip(state, playerId, targetPlayerId, cardId) {
  assertCurrent(state, playerId);
  if (state.turnStage !== "action") throw new Phase10Error("Draw before playing a Skip card.");
  const player = currentPlayer(state);
  const card = player.hand.find((c) => c.id === cardId);
  if (!card || card.type !== "skip") throw new Phase10Error("Choose a Skip card.");
  if (targetPlayerId === playerId) throw new Phase10Error("You cannot skip yourself.");
  const target = findPlayer(state, targetPlayerId);
  if (target.skipped) throw new Phase10Error("That player is already marked to be skipped.");
  player.hand = player.hand.filter((c) => c.id !== cardId);
  state.discardPile.push(card);
  target.skipped = true;
  state.lastAction = { type: "playSkip", playerId, targetPlayerId, cardId };
  // Playing a Skip is the turn's discard, so it ends the turn.
  if (player.hand.length === 0) finishRound(state, player.id);
  else advanceTurn(state);
}

function finishRound(state, finisherId) {
  for (const player of state.players) player.score += scoreHand(player.hand);
  state.lastAction = { type: "roundEnd", finisherId };
  const finisher = findPlayer(state, finisherId);
  if (finisher.phase === 10) {
    state.status = "finished";
    state.winnerId = finisher.id;
    return;
  }

  // Any player who completed their phase advances; all players begin a fresh round.
  for (const player of state.players) {
    if (player.laidPhase) player.phase += 1;
    player.hand = [];
    player.laidPhase = false;
    player.tableau = [];
    player.skipped = false;
  }
  state.roundNumber += 1;
  state.currentPlayerIndex = state.players.findIndex((p) => p.id === finisherId);
  state.drawPile = shuffle(createDeck(), state.rng);
  state.discardPile = [];
  for (let n = 0; n < 10; n++) {
    for (const player of state.players) player.hand.push(state.drawPile.pop());
  }
  state.discardPile.push(state.drawPile.pop());
  state.turnStage = "draw";
}

export function getPhaseDescription(phaseNumber) {
  const phase = PHASES[phaseNumber - 1];
  if (!phase) throw new Phase10Error("Phase number must be between 1 and 10.");
  return phase.map(({ type, count }) => {
    if (type === "set") return `a set of ${count}`;
    if (type === "run") return `a run of ${count}`;
    return `${count} cards of one color`;
  }).join(" + ");
}