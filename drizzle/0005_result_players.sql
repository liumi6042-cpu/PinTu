CREATE TABLE IF NOT EXISTS puzzle_result_players (
 room_id TEXT NOT NULL, owner_id TEXT NOT NULL,
 PRIMARY KEY (room_id,owner_id)
);
CREATE INDEX IF NOT EXISTS puzzle_result_players_owner_idx ON puzzle_result_players(owner_id,room_id);
CREATE INDEX IF NOT EXISTS puzzle_results_week_idx ON puzzle_results(mode,image_id,piece_count,player_count,completed_at,elapsed_ms);
