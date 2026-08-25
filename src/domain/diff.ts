import type { ImportChange, MapResult, MatchData, PlayerStat } from "./types";

interface ComparableField {
  field: string;
  value: string;
}

function present(value: string): boolean {
  return value.trim().length > 0;
}

function compareField(previous: ComparableField | undefined, next: ComparableField): ImportChange | null {
  if (!previous) {
    return present(next.value) ? { field: next.field, kind: "added", after: next.value } : null;
  }
  if (!present(next.value) && present(previous.value)) {
    return { field: next.field, kind: "retained", before: previous.value };
  }
  if (previous.value === next.value) {
    return { field: next.field, kind: "unchanged", before: previous.value, after: next.value };
  }
  return { field: next.field, kind: "changed", before: previous.value, after: next.value };
}

function scalarFields(match: MatchData): ComparableField[] {
  return [
    { field: "team one", value: match.team1.name },
    { field: "team two", value: match.team2.name },
    { field: "series score", value: `${match.seriesScore[0]}–${match.seriesScore[1]}` },
    { field: "event", value: match.event },
    { field: "stage", value: match.stage },
    { field: "context", value: match.context },
    { field: "series format", value: `BO${match.bestOf}` },
  ];
}

function mapValue(map: MapResult): string {
  return `${map.team1Score}–${map.team2Score}`;
}

function playerValue(player: PlayerStat): string {
  return `${player.kills}–${player.deaths}, ${player.adr.toFixed(1)} ADR, ${player.rating.toFixed(2)}`;
}

function compareCollection<T>(
  previous: T[],
  next: T[],
  key: (value: T) => string,
  label: (value: T) => string,
  value: (value: T) => string,
): ImportChange[] {
  const previousByKey = new Map(previous.map((entry) => [key(entry), entry]));
  const nextKeys = new Set(next.map(key));
  const changes = next.map((entry) =>
    compareField(
      previousByKey.has(key(entry))
        ? { field: label(entry), value: value(previousByKey.get(key(entry))!) }
        : undefined,
      { field: label(entry), value: value(entry) },
    ),
  );
  for (const entry of previous) {
    if (!nextKeys.has(key(entry))) {
      changes.push({ field: label(entry), kind: "retained", before: value(entry) });
    }
  }
  return changes.filter((change): change is ImportChange => change !== null);
}

export function summarizeMatchChanges(previous: MatchData | null, next: MatchData): ImportChange[] {
  const previousScalars = new Map((previous ? scalarFields(previous) : []).map((field) => [field.field, field]));
  const scalars = scalarFields(next)
    .map((field) => compareField(previousScalars.get(field.field), field))
    .filter((change): change is ImportChange => change !== null);
  return [
    ...scalars,
    ...compareCollection(
      previous?.maps ?? [],
      next.maps,
      (map) => map.id || map.name.toLowerCase(),
      (map) => `map:${map.name}`,
      mapValue,
    ),
    ...compareCollection(
      previous?.players ?? [],
      next.players,
      (player) => player.id || `${player.team}:${player.name}`,
      (player) => `player:${player.name}`,
      playerValue,
    ),
  ];
}
