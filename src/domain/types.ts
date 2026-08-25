export type Confidence = "confident" | "review" | "missing";

export interface Team {
  id: string;
  name: string;
}

export interface MapResult {
  id: string;
  name: string;
  team1Score: number;
  team2Score: number;
  halfScore?: string;
  statsUrl?: string;
  sourceKind?: "main-match" | "map-stats";
  sourceState?: "live" | "completed" | "unknown";
}

export interface PlayerStat {
  id: string;
  name: string;
  team: string;
  teamSide?: "team1" | "team2";
  kills: number;
  deaths: number;
  swing: string;
  adr: number;
  kast: string;
  rating: number;
  sourceKind?: "main-match" | "map-stats";
  sourceState?: "live" | "completed" | "unknown";
}

export interface MatchData {
  id: string;
  sourceUrl: string;
  team1: Team;
  team2: Team;
  seriesScore: [number, number];
  event: string;
  stage: string;
  bestOf: number;
  maps: MapResult[];
  players: PlayerStat[];
  context: string;
  sourceKind?: "main-match" | "map-stats";
  state?: "live" | "completed" | "unknown";
}

export type ManualFields = Partial<{
  team1Name: string;
  team2Name: string;
  team1Score: number;
  team2Score: number;
  event: string;
  stage: string;
  context: string;
}>;

export interface ImportRecord {
  id: string;
  capturedAt: string;
  active: boolean;
  fingerprint: string;
  match: MatchData;
  diagnostics?: string[];
  changes?: ImportChange[];
  raw?: { plain: string; html: string };
}

export type ImportChangeKind = "added" | "changed" | "unchanged" | "retained";

export interface ImportChange {
  field: string;
  kind: ImportChangeKind;
  before?: string;
  after?: string;
}

export interface DraftLedger {
  id: string;
  createdAt: string;
  updatedAt: string;
  imports: ImportRecord[];
  manual: ManualFields;
  manualBaselines?: ManualFields;
  manualMaps?: Record<string, Partial<Pick<MapResult, "name" | "team1Score" | "team2Score">>>;
  manualPlayers?: Record<
    string,
    Partial<Pick<PlayerStat, "name" | "team" | "teamSide" | "kills" | "deaths" | "adr" | "swing" | "rating">>
  >;
}

export interface FieldConflict {
  field: keyof ManualFields;
  mine: string | number;
  imported: string | number;
}

export interface DraftProjection {
  match: MatchData | null;
  conflicts: FieldConflict[];
}

export interface ImportProposal {
  kind: "main-match" | "map-stats" | "unrecognized" | "rejected";
  confidence: Confidence;
  match: MatchData | null;
  diagnostics: string[];
  fingerprint: string;
}
