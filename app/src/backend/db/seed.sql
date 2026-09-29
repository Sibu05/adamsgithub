-- ============================================================
--  SEED DATA
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

TRUNCATE TABLE user_credentials;
TRUNCATE TABLE leaderboard_entries;
TRUNCATE TABLE seasons;
TRUNCATE TABLE user_cosmetics;
TRUNCATE TABLE cosmetics;
TRUNCATE TABLE point_transactions;
TRUNCATE TABLE trades;
TRUNCATE TABLE battle_turns;
TRUNCATE TABLE battle_decks;
TRUNCATE TABLE battles;
TRUNCATE TABLE audit_log;
TRUNCATE TABLE user_discovered_events;
TRUNCATE TABLE trivia_attempts;
TRUNCATE TABLE location_check_log;
TRUNCATE TABLE event_card_awards;
TRUNCATE TABLE user_cards;
TRUNCATE TABLE event_card_pool;
TRUNCATE TABLE cards;
TRUNCATE TABLE trivia_options;
TRUNCATE TABLE trivia_questions;
TRUNCATE TABLE events;
TRUNCATE TABLE admin_roles;
TRUNCATE TABLE moderation_actions;
TRUNCATE TABLE user_trust_scores;
TRUNCATE TABLE users;

SET FOREIGN_KEY_CHECKS = 1;

-- 1. USERS
INSERT INTO users (user_id, provider_id, email, name, avatar_url, points) VALUES
(1, 'google-oauth2|1001', 'alice@example.com', 'Alice Nkosi', 'https://example.com/avatars/alice.png', 150),
(2, 'google-oauth2|1002', 'bob@example.com',   'Bob van Wyk', 'https://example.com/avatars/bob.png',   90);

-- 2. ADMIN ROLES
INSERT INTO admin_roles (role_id, user_id, role, granted_by) VALUES
(1, 1, 'SUPER_ADMIN',  NULL),
(2, 2, 'EVENT_AUTHOR', 1);

-- 3. EVENTS
INSERT INTO events (event_id, title, description, latitude, longitude, radius_meters, point_threshold, point_reward, starts_at, ends_at, repeat_interval, attempt_cooldown_s, max_attempts_per_window, is_active, author_id) VALUES
(1, 'Origins of Gold Reef City', 'Trivia about the founding of the Witwatersrand gold rush.', -26.20227000, 28.04363000, 100, 0, 20, '2026-01-01 00:00:00', '2026-12-31 23:59:59', NULL, 86400, 1, TRUE, 1),
(2, 'Constitution Hill Chronicles', 'History of the old fort and Constitutional Court.', -26.19070000, 28.04120000, 75, 0, 15, '2026-01-01 00:00:00', '2026-12-31 23:59:59', NULL, 43200, 2, TRUE, 2);

-- 4. TRIVIA QUESTIONS
INSERT INTO trivia_questions (question_id, event_id, format, body, time_limit_s, difficulty) VALUES
(1, 1, 'MULTIPLE_CHOICE', 'In what year was gold discovered on the Witwatersrand?', 30, 1),
(2, 2, 'TRUE_FALSE',      'The Old Fort was originally built as a women''s prison.', 20, 2);

-- 5. TRIVIA OPTIONS
INSERT INTO trivia_options (option_id, question_id, body, is_correct) VALUES
(1, 1, '1886', TRUE),
(2, 1, '1901', FALSE),
(3, 1, '1652', FALSE),
(4, 2, 'False', TRUE),
(5, 2, 'True',  FALSE);

-- 6. CARDS
INSERT INTO cards (card_id, name, flavour_text, image_url, category, rarity, stat_attack, stat_location, stat_influence, stat_legacy, stat_era, ability_name, ability_desc) VALUES
(1, 'Jan Smuts', 'Statesman and soldier who served as the first Chancellor of the University of the Witwatersrand.', 'https://example.com/cards/jan_smuts.png', 'CHARACTER', 'LEGENDARY', 40, 25, 90, 100, 1922, 'Statesman''s Address', 'Boosts influence stat by 15 for one turn.'),
(2, 'Jan Hofmeyr', 'Precocious scholar appointed the first Principal of Wits at just 27 years old.', 'https://example.com/cards/jan_hofmeyr.png', 'CHARACTER', 'RARE', 30, 20, 65, 100, 1922, 'Founding Vision', 'Boosts legacy stat by 10 for one turn.'),
(3, 'Raymond Dart', 'Anatomy professor whose analysis of a small skull rewrote the story of human origins.', 'https://example.com/cards/raymond_dart.png', 'CHARACTER', 'RARE', 25, 15, 55, 100, 1925, 'Taung Discovery', 'Reveals the opponent''s highest stat before this round.'),
(4, 'Phillip Tobias', 'Palaeoanthropologist who spent decades excavating and interpreting the Sterkfontein fossils.', 'https://example.com/cards/phillip_tobias.png', 'CHARACTER', 'RARE', 20, 20, 60, 100, 1959, 'Fossil Record', 'Boosts era stat by 10 for one turn.'),
(5, 'Nelson Mandela', 'Studied law at Wits in the 1940s, forming friendships and convictions that shaped his future.', 'https://example.com/cards/nelson_mandela.png', 'CHARACTER', 'LEGENDARY', 35, 20, 100, 100, 1943, 'Long Walk', 'Boosts all stats by 5 for one turn.'),
(6, 'Robert Sobukwe', 'Wits-educated activist who went on to found the Pan Africanist Congress.', 'https://example.com/cards/robert_sobukwe.png', 'CHARACTER', 'RARE', 35, 15, 70, 90, 1949, 'Call to Action', 'Boosts influence stat by 12 for one turn.'),
(7, 'Helen Suzman', 'Wits economics graduate who became a lone parliamentary voice against apartheid for decades.', 'https://example.com/cards/helen_suzman.png', 'CHARACTER', 'RARE', 25, 15, 75, 95, 1953, 'Sole Dissent', 'Negates one opposing buff for this round.'),
(8, 'Joe Slovo', 'Wits law graduate and anti-apartheid activist who later helped negotiate South Africa''s transition.', 'https://example.com/cards/joe_slovo.png', 'CHARACTER', 'COMMON', 30, 10, 55, 85, 1950, NULL, NULL),
(9, 'Ruth First', 'Wits graduate, journalist and academic whose writing exposed the machinery of apartheid.', 'https://example.com/cards/ruth_first.png', 'CHARACTER', 'COMMON', 20, 10, 60, 85, 1946, NULL, NULL),
(10, 'Es''kia Mphahlele', 'Writer and scholar who held a professorship in African Literature at Wits.', 'https://example.com/cards/eskia_mphahlele.png', 'CHARACTER', 'COMMON', 15, 10, 45, 80, 1979, NULL, NULL),
(11, 'South African School of Mines', 'The Kimberley institution founded in 1896 that would eventually grow into Wits.', 'https://example.com/cards/school_of_mines.png', 'HISTORICAL', 'RARE', 15, 30, 40, 90, 1896, 'Humble Beginnings', 'Boosts legacy stat by 10 for one turn.'),
(12, 'Founding of Wits', 'The University of the Witwatersrand was formally established by an Act of Parliament.', 'https://example.com/cards/founding_of_wits.png', 'HISTORICAL', 'LEGENDARY', 20, 35, 80, 100, 1922, 'Act of Parliament', 'Boosts legacy stat by 20 for one turn.'),
(13, 'The Taung Child Discovery', 'A fossilised skull from Taung became the first evidence of Australopithecus africanus.', 'https://example.com/cards/taung_child.png', 'HISTORICAL', 'RARE', 10, 25, 50, 100, 1924, 'Missing Link', 'Reveals the opponent''s lowest stat before this round.'),
(14, 'Milner Park', 'The former Johannesburg showgrounds that became the site of Wits'' main campus.', 'https://example.com/cards/milner_park.png', 'LOCATION', 'COMMON', 5, 45, 20, 85, 1922, NULL, NULL),
(15, 'The Great Hall', 'Wits'' ceremonial centrepiece, its cornerstone laid in the early 1930s.', 'https://example.com/cards/great_hall.png', 'LOCATION', 'COMMON', 5, 50, 25, 90, 1932, NULL, NULL),
(16, 'William Cullen Library', 'Home to Wits'' rare books, manuscripts and historical archives.', 'https://example.com/cards/cullen_library.png', 'LOCATION', 'COMMON', 5, 40, 20, 85, 1932, NULL, NULL),
(17, 'Sterkfontein Caves', 'A fossil-rich cave system in the Cradle of Humankind, long studied by Wits researchers.', 'https://example.com/cards/sterkfontein.png', 'LOCATION', 'RARE', 10, 55, 30, 95, 1936, 'Cradle of Humankind', 'Boosts location stat by 15 for one turn.'),
(18, 'Bernard Price Institute', 'A geophysics research institute established at Wits through Bernard Price''s funding.', 'https://example.com/cards/bernard_price_institute.png', 'INFLUENCE', 'COMMON', 10, 20, 45, 80, 1937, NULL, NULL),
(19, 'Chamber of Mines', 'The mining industry body whose backing helped establish the original School of Mines.', 'https://example.com/cards/chamber_of_mines.png', 'INFLUENCE', 'COMMON', 15, 15, 50, 80, 1896, NULL, NULL),
(20, 'Wits Rag', 'A long-running student festival and charity tradition dating back to the 1920s.', 'https://example.com/cards/wits_rag.png', 'INFLUENCE', 'COMMON', 5, 10, 35, 75, 1925, NULL, NULL),
(21, 'Barney Barnato', 'A diamond magnate turned gold speculator.', 'https://example.com/cards/barnato.png', 'CHARACTER', 'RARE', 45, 20, 60, 100, 1886, 'Market Cornering', 'Boosts influence stat by 10 for one turn.'),
(22, 'Gold Reef City Mine Shaft', 'A relic of the original mining boom.', 'https://example.com/cards/mineshaft.png', 'LOCATION', 'COMMON', 10, 55, 15, 100, 1886, NULL, NULL);

-- 7. EVENT CARD POOL
INSERT INTO event_card_pool (pool_id, event_id, card_id, weight, global_copy_limit, copies_awarded) VALUES
(1, 1, 1, 1, 50, 1),
(2, 1, 2, 3, NULL, 4);

-- 8. USER CARDS
INSERT INTO user_cards (user_card_id, user_id, card_id, quantity) VALUES
(1, 2, 2, 2),
(2, 1, 1, 3),
(3, 2, 22, 1),
(6, 2, 3, 1),
(9, 2, 8, 1),
(8, 2, 12, 1),
(4, 2, 13, 1),
(5, 2, 15, 1),
(7, 2, 18, 1),
(10, 2, 19, 1),
(11, 1, 22, 1),
(12, 1, 3, 1),
(13, 1, 8, 1),
(14, 1, 12, 1),
(15, 1, 13, 1),
(16, 1, 15, 1),
(17, 1, 18, 1),
(18, 1, 19, 1);

-- 9. EVENT CARD AWARDS
INSERT INTO event_card_awards (award_id, user_id, event_id, card_id) VALUES
(1, 1, 1, 1);

-- 10. LOCATION CHECK LOG
INSERT INTO location_check_log (check_id, user_id, event_id, claimed_lat, claimed_lng, distance_meters, status, prev_check_id, travel_speed_ms) VALUES
(1, 1, 1, -26.20230000, 28.04360000, 4.20, 'VERIFIED', NULL, NULL),
(2, 2, 2, -26.19075000, 28.04125000, 6.80, 'VERIFIED', NULL, NULL);

-- 11. TRIVIA ATTEMPTS
INSERT INTO trivia_attempts (attempt_id, user_id, event_id, question_id, location_check_id, is_correct, answer_time_ms, card_awarded_id, points_awarded, hint_used, attempt_number, cooldown_until) VALUES
(1, 1, 1, 1, 1, TRUE,  4200, 1, 20, FALSE, 1, '2026-01-02 00:00:00'),
(2, 2, 2, 2, 2, FALSE, 8900, NULL, 0, TRUE,  1, '2026-01-01 12:00:00');

-- 12. USER DISCOVERED EVENTS
INSERT INTO user_discovered_events (user_id, event_id) VALUES
(1, 1),
(2, 2);

-- 13. AUDIT LOG
INSERT INTO audit_log (log_id, actor_id, action, target_table, target_id, before_state, after_state) VALUES
(1, 1, 'CREATE', 'events', 1, NULL, JSON_OBJECT('title', 'Origins of Gold Reef City', 'is_active', TRUE)),
(2, 2, 'UPDATE', 'events', 2, JSON_OBJECT('point_reward', 10), JSON_OBJECT('point_reward', 15));

-- 14. BATTLES
INSERT INTO battles (battle_id, player1_id, player2_id, winner_id, status, started_at, ended_at) VALUES
(1, 1, 2, 1, 'COMPLETED', '2026-01-05 10:00:00', '2026-01-05 10:15:00');

-- 15. BATTLE DECKS
INSERT INTO battle_decks (deck_id, battle_id, user_id, card_id, slot_position) VALUES
(1, 1, 1, 1, 1),
(2, 1, 2, 2, 1);

-- 16. BATTLE TURNS
INSERT INTO battle_turns (turn_id, battle_id, turn_number, acting_user_id, deck_slot_played_id, deck_slot_targeted_id, action, damage_dealt, landed, effect_data) VALUES
(1, 1, 1, 1, 1, 2, 'ATTACK', 45, true, null),
(2, 1, 2, 2, 2, 2, 'DEFEND', 0, null, null);

-- 17. TRADES
INSERT INTO trades (trade_id, initiator_id, receiver_id, initiator_card_id, receiver_card_id, status, resolved_at) VALUES
(1, 1, 2, 1, 2, 'PENDING', NULL);

-- 18. POINT TRANSACTIONS
INSERT INTO point_transactions (txn_id, user_id, delta, reason, reference_id) VALUES
(1, 1, 20, 'TRIVIA_WIN', 1),
(2, 2, -5, 'HINT_PURCHASE', 2);

-- 19. COSMETICS
INSERT INTO cosmetics (cosmetic_id, name, description, type, point_cost, image_url) VALUES
(1, 'Golden Frame', 'A shimmering card frame themed after the gold rush.', 'CARD_FRAME', 100, 'https://example.com/cosmetics/golden_frame.png'),
(2, 'Fort Spotlight', 'A dramatic battle effect inspired by Constitution Hill.', 'BATTLE_EFFECT', 75, 'https://example.com/cosmetics/fort_spotlight.png');

-- 20. USER COSMETICS
INSERT INTO user_cosmetics (user_id, cosmetic_id) VALUES
(1, 1),
(2, 2);

-- 21. SEASONS
INSERT INTO seasons (season_id, name, starts_at, ends_at, is_active) VALUES
(1, 'Season 1: Founding Era', '2026-01-01 00:00:00', '2026-06-30 23:59:59', TRUE);

-- 22. LEADERBOARD ENTRIES
INSERT INTO leaderboard_entries (entry_id, season_id, user_id, wins, losses, score) VALUES
(1, 1, 1, 3, 1, 320),
(2, 1, 2, 1, 3, 110);

-- USER CREDENTIALS (PIN: 1234 for all users)
INSERT INTO user_credentials (user_id, pin_hash) VALUES
(1, '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4'),
(2, '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4');

-- Seed test admin user
INSERT IGNORE INTO users (provider_id, email, name)
VALUES ('local:admin@wits.ac.za', 'admin@wits.ac.za', 'Test Admin');

SET @admin_user_id = (SELECT user_id FROM users WHERE email = 'admin@wits.ac.za');
SET @test_user_id = (SELECT user_id FROM users WHERE email = 'alice@example.com');
SET @test2_user_id = (SELECT user_id FROM users WHERE email = 'bob@example.com');

REPLACE INTO user_credentials (user_id, pin_hash)
VALUES (@admin_user_id, '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4');
REPLACE INTO user_credentials (user_id, pin_hash)
VALUES (@test_user_id, '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4');
REPLACE INTO user_credentials (user_id, pin_hash)
VALUES (@test2_user_id, '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4');

INSERT IGNORE INTO admin_roles (user_id, role, granted_by)
VALUES (@admin_user_id, 'SUPER_ADMIN', @admin_user_id);

-- Seed test player user (no admin roles)
INSERT IGNORE INTO users (provider_id, email, name)
VALUES ('local:player@example.com', 'player@example.com', 'Test Player');

SET @player_user_id = (SELECT user_id FROM users WHERE email = 'player@example.com');

REPLACE INTO user_credentials (user_id, pin_hash)
VALUES (@player_user_id, '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4');

-- 23. MOCKED TRUST SCORES (User Story 5)
INSERT INTO user_trust_scores (user_id, trust_score, reason, evidence) VALUES
(2, 22.50, 'Repeated spoofed location + impossible travel',
 JSON_ARRAY(
   JSON_OBJECT('type','SPOOFED_LOCATION','detail','SPOOFED at Constitution Hill (distance 1240m vs 75m radius)','event_id',2,'distance_meters',1240,'status','SPOOFED','checked_at','2026-01-04T10:00:00Z'),
   JSON_OBJECT('type','IMPOSSIBLE_TRAVEL','detail','85.5 m/s between Gold Reef City and Constitution Hill (2 min interval)','travel_speed_ms',85.5,'prev_event_id',1,'curr_event_id',2,'checked_at','2026-01-04T10:02:00Z'),
   JSON_OBJECT('type','FAILED_LOCATION','detail','FAILED check at Origins of Gold Reef City (890m out)','event_id',1,'distance_meters',890,'status','FAILED','checked_at','2026-01-03T15:30:00Z')
 )),
(@player_user_id, 44.00, 'Velocity anomaly + repeated out-of-range attempts',
 JSON_ARRAY(
   JSON_OBJECT('type','IMPOSSIBLE_TRAVEL','detail','42.1 m/s travel flagged','travel_speed_ms',42.1,'checked_at','2026-01-05T09:12:00Z'),
   JSON_OBJECT('type','FAILED_LOCATION','detail','3 failed location checks in 10 minutes','count',3,'status','FAILED','checked_at','2026-01-05T09:00:00Z')
 )),
(@admin_user_id, 58.00, 'Occasional spoof flag (single incident)',
 JSON_ARRAY(
   JSON_OBJECT('type','SPOOFED_LOCATION','detail','Single SPOOFED log (possible GPS drift)','distance_meters',310,'status','SPOOFED','checked_at','2026-01-02T11:20:00Z')
 ));

-- Seed a dedicated moderator account (User Story 5)
INSERT IGNORE INTO users (provider_id, email, name)
VALUES ('local:moderator@example.com', 'moderator@example.com', 'Maya Moderator');

SET @mod_user_id = (SELECT user_id FROM users WHERE email = 'moderator@example.com');

REPLACE INTO user_credentials (user_id, pin_hash)
VALUES (@mod_user_id, '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4');

INSERT IGNORE INTO admin_roles (user_id, role, granted_by)
VALUES (@mod_user_id, 'MODERATOR', @admin_user_id);
