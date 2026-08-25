import type {
  DraftLedger,
  DraftProjection,
  FieldConflict,
  ManualFields,
  MapResult,
  MatchData,
  PlayerStat,
} from "./types";

function hasText(value: string | undefined): value is string {
  return Boolean(value?.trim());
}

function stateAuthority(state: MatchData["state"]): number {
  if (state === "completed") return 3;
  if (state === "live") return 2;
  return 1;
}

function coreAuthority(match: MatchData): number {
  return (match.sourceKind === "map-stats" ? 0 : 10) + stateAuthority(match.state);
}

function detailAuthority(value: {
  sourceKind?: MatchData["sourceKind"];
  sourceState?: MatchData["state"];
}): number {
  return (value.sourceKind === "map-stats" ? 10 : 0) + stateAuthority(value.sourceState);
}

function mergeMaps(previous: MapResult[], next: MapResult[]): MapResult[] {
  const merged = new Map<string, MapResult>();
  for (const map of previous) merged.set(map.id || map.name.toLowerCase(), map);
  for (const map of next) {
    const key = map.id || map.name.toLowerCase();
    const current = merged.get(key);
    if (!current || detailAuthority(map) >= detailAuthority(current)) merged.set(key, map);
  }
  return [...merged.values()];
}

function mergePlayers(previous: PlayerStat[], next: PlayerStat[]): PlayerStat[] {
  if (next.length === 0) return previous;
  const merged = new Map<string, PlayerStat>();
  for (const player of previous) merged.set(player.id || `${player.team}:${player.name}`, player);
  for (const player of next) {
    const key = player.id || `${player.team}:${player.name}`;
    const current = merged.get(key);
    if (!current || detailAuthority(player) >= detailAuthority(current)) merged.set(key, player);
  }
  return [...merged.values()];
}

function mergeMatch(previous: MatchData, next: MatchData): MatchData {
  const nextOwnsCore = coreAuthority(next) >= coreAuthority(previous);
  const primary = nextOwnsCore ? next : previous;
  const fallback = nextOwnsCore ? previous : next;
  return {
    ...fallback,
    ...primary,
    sourceUrl: hasText(primary.sourceUrl) ? primary.sourceUrl : fallback.sourceUrl,
    event: hasText(primary.event) ? primary.event : fallback.event,
    stage: hasText(primary.stage) ? primary.stage : fallback.stage,
    context: hasText(primary.context) ? primary.context : fallback.context,
    team1: hasText(primary.team1.name) ? primary.team1 : fallback.team1,
    team2: hasText(primary.team2.name) ? primary.team2 : fallback.team2,
    maps: mergeMaps(previous.maps, next.maps),
    players: mergePlayers(previous.players, next.players),
  };
}

function scalarParserValues(match: MatchData): Required<ManualFields> {
  return {
    sourceUrl: match.sourceUrl,
    team1Name: match.team1.name,
    team2Name: match.team2.name,
    team1Country: match.team1.country ?? "",
    team2Country: match.team2.country ?? "",
    team1Score: match.seriesScore[0],
    team2Score: match.seriesScore[1],
    event: match.event,
    stage: match.stage,
    context: match.context,
  };
}

export function replayDraft(ledger: DraftLedger): DraftProjection {
  const active = ledger.imports.filter((entry) => entry.active);
  if (active.length === 0) return { match: null, conflicts: [] };

  const parserMatch = active
    .slice(1)
    .reduce((match, entry) => mergeMatch(match, entry.match), structuredClone(active[0].match));
  const parserValues = scalarParserValues(parserMatch);
  const conflicts: FieldConflict[] = [];

  for (const [field, mine] of Object.entries(ledger.manual) as Array<
    [keyof ManualFields, string | number]
  >) {
    const imported = parserValues[field];
    const baseline = ledger.manualBaselines?.[field];
    if (baseline !== undefined && imported !== baseline && mine !== imported && imported !== "") {
      conflicts.push({ field, mine, imported });
    }
  }

  const match = structuredClone(parserMatch);
  if (ledger.manual.sourceUrl !== undefined) match.sourceUrl = ledger.manual.sourceUrl;
  if (ledger.manual.team1Name !== undefined) match.team1.name = ledger.manual.team1Name;
  if (ledger.manual.team2Name !== undefined) match.team2.name = ledger.manual.team2Name;
  if (ledger.manual.team1Country !== undefined) match.team1.country = ledger.manual.team1Country;
  if (ledger.manual.team2Country !== undefined) match.team2.country = ledger.manual.team2Country;
  if (ledger.manual.team1Score !== undefined) match.seriesScore[0] = ledger.manual.team1Score;
  if (ledger.manual.team2Score !== undefined) match.seriesScore[1] = ledger.manual.team2Score;
  if (ledger.manual.event !== undefined) match.event = ledger.manual.event;
  if (ledger.manual.stage !== undefined) match.stage = ledger.manual.stage;
  if (ledger.manual.context !== undefined) match.context = ledger.manual.context;
  match.players = match.players.map((player) => {
    if (player.teamSide === "team1") return { ...player, team: match.team1.name };
    if (player.teamSide === "team2") return { ...player, team: match.team2.name };
    if (player.team === parserMatch.team1.name) return { ...player, team: match.team1.name };
    if (player.team === parserMatch.team2.name) return { ...player, team: match.team2.name };
    return player;
  });
  match.maps = match.maps.map((map) => ({ ...map, ...(ledger.manualMaps?.[map.id] ?? {}) }));
  match.players = match.players.map((player) => ({
    ...player,
    ...(ledger.manualPlayers?.[player.id] ?? {}),
  }));

  return { match, conflicts };
}

export function parserValueForField(
  ledger: DraftLedger,
  field: keyof ManualFields,
): string | number | undefined {
  const active = ledger.imports.filter((entry) => entry.active);
  if (active.length === 0) return undefined;
  const parserMatch = active
    .slice(1)
    .reduce((match, entry) => mergeMatch(match, entry.match), structuredClone(active[0].match));
  return scalarParserValues(parserMatch)[field];
}
