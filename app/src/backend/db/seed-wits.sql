-- ============================================================
--  WITS CAMPUS SEED  (npm run db:seed-wits)
--
--  Six published events on the Wits main campus, placed on the
--  walkable path graph (placement/campus_paths.json), each with 3-4
--  questions (multiple choice, true/false, fill-in-the-blank). Pop-ups
--  only copy questions from events within 100 m of those paths, so
--  this gives procedural placement Wits content to use.
--
--  ADDITIVE and IDEMPOTENT: unlike seed.sql it truncates nothing.
--  Every insert is guarded with NOT EXISTS, so running it again adds
--  nothing new. Needs at least one user (run db:seed first on an empty
--  DB). Events are authored by the first SUPER_ADMIN, else the lowest
--  user_id.
--
--  Generated file: no semicolons inside text, because
--  utils/sql_utils.js splits scripts on every semicolon.
-- ============================================================

-- ── Great Hall ──────────────────────────────
INSERT INTO events (title, description, latitude, longitude, radius_meters, point_reward, is_active, author_id, curation_status, published_at)
SELECT 'Great Hall', 'The Great Hall on East Campus, part of the Central Block and the heart of Wits graduations.', -26.19152400, 28.03030500, 40, 15, TRUE, COALESCE((SELECT MIN(user_id) FROM admin_roles WHERE role = 'SUPER_ADMIN'), (SELECT MIN(user_id) FROM users)), 'PUBLISHED', UTC_TIMESTAMP()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM events WHERE title = 'Great Hall' AND is_procedural = FALSE);

INSERT INTO trivia_questions (event_id, format, body, time_limit_s, difficulty)
SELECT (SELECT event_id FROM events WHERE title = 'Great Hall' AND is_procedural = FALSE ORDER BY event_id LIMIT 1), 'MULTIPLE_CHOICE', 'In which year did the University of the Witwatersrand become a full university?', 30, 1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Great Hall' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'In which year did the University of the Witwatersrand become a full university?');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Great Hall' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'In which year did the University of the Witwatersrand become a full university?' ORDER BY question_id LIMIT 1), '1896', FALSE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Great Hall' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'In which year did the University of the Witwatersrand become a full university?' ORDER BY question_id LIMIT 1) AND body = '1896');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Great Hall' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'In which year did the University of the Witwatersrand become a full university?' ORDER BY question_id LIMIT 1), '1922', TRUE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Great Hall' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'In which year did the University of the Witwatersrand become a full university?' ORDER BY question_id LIMIT 1) AND body = '1922');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Great Hall' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'In which year did the University of the Witwatersrand become a full university?' ORDER BY question_id LIMIT 1), '1948', FALSE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Great Hall' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'In which year did the University of the Witwatersrand become a full university?' ORDER BY question_id LIMIT 1) AND body = '1948');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Great Hall' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'In which year did the University of the Witwatersrand become a full university?' ORDER BY question_id LIMIT 1), '1994', FALSE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Great Hall' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'In which year did the University of the Witwatersrand become a full university?' ORDER BY question_id LIMIT 1) AND body = '1994');

INSERT INTO trivia_questions (event_id, format, body, time_limit_s, difficulty)
SELECT (SELECT event_id FROM events WHERE title = 'Great Hall' AND is_procedural = FALSE ORDER BY event_id LIMIT 1), 'TRUE_FALSE', 'Wits University is in Johannesburg, South Africa.', 30, 1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Great Hall' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'Wits University is in Johannesburg, South Africa.');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Great Hall' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'Wits University is in Johannesburg, South Africa.' ORDER BY question_id LIMIT 1), 'True', TRUE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Great Hall' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'Wits University is in Johannesburg, South Africa.' ORDER BY question_id LIMIT 1) AND body = 'True');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Great Hall' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'Wits University is in Johannesburg, South Africa.' ORDER BY question_id LIMIT 1), 'False', FALSE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Great Hall' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'Wits University is in Johannesburg, South Africa.' ORDER BY question_id LIMIT 1) AND body = 'False');

INSERT INTO trivia_questions (event_id, format, body, time_limit_s, difficulty)
SELECT (SELECT event_id FROM events WHERE title = 'Great Hall' AND is_procedural = FALSE ORDER BY event_id LIMIT 1), 'FILL_BLANK', 'Wits is short for the University of the ____.', 30, 1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Great Hall' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'Wits is short for the University of the ____.');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Great Hall' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'Wits is short for the University of the ____.' ORDER BY question_id LIMIT 1), 'Witwatersrand', TRUE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Great Hall' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'Wits is short for the University of the ____.' ORDER BY question_id LIMIT 1) AND body = 'Witwatersrand');

INSERT INTO trivia_questions (event_id, format, body, time_limit_s, difficulty)
SELECT (SELECT event_id FROM events WHERE title = 'Great Hall' AND is_procedural = FALSE ORDER BY event_id LIMIT 1), 'MULTIPLE_CHOICE', 'Wits grew out of the South African School of Mines. In which city was that school founded in 1896?', 30, 1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Great Hall' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'Wits grew out of the South African School of Mines. In which city was that school founded in 1896?');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Great Hall' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'Wits grew out of the South African School of Mines. In which city was that school founded in 1896?' ORDER BY question_id LIMIT 1), 'Kimberley', TRUE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Great Hall' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'Wits grew out of the South African School of Mines. In which city was that school founded in 1896?' ORDER BY question_id LIMIT 1) AND body = 'Kimberley');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Great Hall' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'Wits grew out of the South African School of Mines. In which city was that school founded in 1896?' ORDER BY question_id LIMIT 1), 'Cape Town', FALSE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Great Hall' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'Wits grew out of the South African School of Mines. In which city was that school founded in 1896?' ORDER BY question_id LIMIT 1) AND body = 'Cape Town');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Great Hall' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'Wits grew out of the South African School of Mines. In which city was that school founded in 1896?' ORDER BY question_id LIMIT 1), 'Durban', FALSE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Great Hall' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'Wits grew out of the South African School of Mines. In which city was that school founded in 1896?' ORDER BY question_id LIMIT 1) AND body = 'Durban');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Great Hall' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'Wits grew out of the South African School of Mines. In which city was that school founded in 1896?' ORDER BY question_id LIMIT 1), 'Pretoria', FALSE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Great Hall' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'Wits grew out of the South African School of Mines. In which city was that school founded in 1896?' ORDER BY question_id LIMIT 1) AND body = 'Pretoria');

-- ── William Cullen Library ──────────────────────────────
INSERT INTO events (title, description, latitude, longitude, radius_meters, point_reward, is_active, author_id, curation_status, published_at)
SELECT 'William Cullen Library', 'The William Cullen Library on East Campus, home to historical papers and rare books.', -26.19044200, 28.02952200, 40, 15, TRUE, COALESCE((SELECT MIN(user_id) FROM admin_roles WHERE role = 'SUPER_ADMIN'), (SELECT MIN(user_id) FROM users)), 'PUBLISHED', UTC_TIMESTAMP()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM events WHERE title = 'William Cullen Library' AND is_procedural = FALSE);

INSERT INTO trivia_questions (event_id, format, body, time_limit_s, difficulty)
SELECT (SELECT event_id FROM events WHERE title = 'William Cullen Library' AND is_procedural = FALSE ORDER BY event_id LIMIT 1), 'TRUE_FALSE', 'The William Cullen Library is on Wits East Campus.', 30, 1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'William Cullen Library' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'The William Cullen Library is on Wits East Campus.');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'William Cullen Library' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'The William Cullen Library is on Wits East Campus.' ORDER BY question_id LIMIT 1), 'True', TRUE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'William Cullen Library' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'The William Cullen Library is on Wits East Campus.' ORDER BY question_id LIMIT 1) AND body = 'True');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'William Cullen Library' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'The William Cullen Library is on Wits East Campus.' ORDER BY question_id LIMIT 1), 'False', FALSE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'William Cullen Library' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'The William Cullen Library is on Wits East Campus.' ORDER BY question_id LIMIT 1) AND body = 'False');

INSERT INTO trivia_questions (event_id, format, body, time_limit_s, difficulty)
SELECT (SELECT event_id FROM events WHERE title = 'William Cullen Library' AND is_procedural = FALSE ORDER BY event_id LIMIT 1), 'MULTIPLE_CHOICE', 'Which of these is kept in the William Cullen Library?', 30, 1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'William Cullen Library' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'Which of these is kept in the William Cullen Library?');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'William Cullen Library' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'Which of these is kept in the William Cullen Library?' ORDER BY question_id LIMIT 1), 'Historical papers and rare books', TRUE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'William Cullen Library' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'Which of these is kept in the William Cullen Library?' ORDER BY question_id LIMIT 1) AND body = 'Historical papers and rare books');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'William Cullen Library' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'Which of these is kept in the William Cullen Library?' ORDER BY question_id LIMIT 1), 'A swimming pool', FALSE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'William Cullen Library' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'Which of these is kept in the William Cullen Library?' ORDER BY question_id LIMIT 1) AND body = 'A swimming pool');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'William Cullen Library' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'Which of these is kept in the William Cullen Library?' ORDER BY question_id LIMIT 1), 'A car workshop', FALSE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'William Cullen Library' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'Which of these is kept in the William Cullen Library?' ORDER BY question_id LIMIT 1) AND body = 'A car workshop');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'William Cullen Library' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'Which of these is kept in the William Cullen Library?' ORDER BY question_id LIMIT 1), 'A planetarium dome', FALSE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'William Cullen Library' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'Which of these is kept in the William Cullen Library?' ORDER BY question_id LIMIT 1) AND body = 'A planetarium dome');

INSERT INTO trivia_questions (event_id, format, body, time_limit_s, difficulty)
SELECT (SELECT event_id FROM events WHERE title = 'William Cullen Library' AND is_procedural = FALSE ORDER BY event_id LIMIT 1), 'FILL_BLANK', 'At a library you can borrow ____.', 30, 1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'William Cullen Library' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'At a library you can borrow ____.');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'William Cullen Library' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'At a library you can borrow ____.' ORDER BY question_id LIMIT 1), 'books', TRUE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'William Cullen Library' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'At a library you can borrow ____.' ORDER BY question_id LIMIT 1) AND body = 'books');

-- ── Origins Centre ──────────────────────────────
INSERT INTO events (title, description, latitude, longitude, radius_meters, point_reward, is_active, author_id, curation_status, published_at)
SELECT 'Origins Centre', 'The Origins Centre museum, about the story of humankind and ancient rock art.', -26.19287400, 28.02859900, 40, 15, TRUE, COALESCE((SELECT MIN(user_id) FROM admin_roles WHERE role = 'SUPER_ADMIN'), (SELECT MIN(user_id) FROM users)), 'PUBLISHED', UTC_TIMESTAMP()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM events WHERE title = 'Origins Centre' AND is_procedural = FALSE);

INSERT INTO trivia_questions (event_id, format, body, time_limit_s, difficulty)
SELECT (SELECT event_id FROM events WHERE title = 'Origins Centre' AND is_procedural = FALSE ORDER BY event_id LIMIT 1), 'MULTIPLE_CHOICE', 'What is the Origins Centre at Wits?', 30, 1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Origins Centre' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'What is the Origins Centre at Wits?');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Origins Centre' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'What is the Origins Centre at Wits?' ORDER BY question_id LIMIT 1), 'A museum about human origins and rock art', TRUE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Origins Centre' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'What is the Origins Centre at Wits?' ORDER BY question_id LIMIT 1) AND body = 'A museum about human origins and rock art');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Origins Centre' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'What is the Origins Centre at Wits?' ORDER BY question_id LIMIT 1), 'A sports stadium', FALSE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Origins Centre' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'What is the Origins Centre at Wits?' ORDER BY question_id LIMIT 1) AND body = 'A sports stadium');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Origins Centre' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'What is the Origins Centre at Wits?' ORDER BY question_id LIMIT 1), 'A student residence', FALSE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Origins Centre' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'What is the Origins Centre at Wits?' ORDER BY question_id LIMIT 1) AND body = 'A student residence');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Origins Centre' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'What is the Origins Centre at Wits?' ORDER BY question_id LIMIT 1), 'A bank', FALSE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Origins Centre' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'What is the Origins Centre at Wits?' ORDER BY question_id LIMIT 1) AND body = 'A bank');

INSERT INTO trivia_questions (event_id, format, body, time_limit_s, difficulty)
SELECT (SELECT event_id FROM events WHERE title = 'Origins Centre' AND is_procedural = FALSE ORDER BY event_id LIMIT 1), 'TRUE_FALSE', 'The Origins Centre is a museum.', 30, 1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Origins Centre' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'The Origins Centre is a museum.');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Origins Centre' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'The Origins Centre is a museum.' ORDER BY question_id LIMIT 1), 'True', TRUE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Origins Centre' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'The Origins Centre is a museum.' ORDER BY question_id LIMIT 1) AND body = 'True');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Origins Centre' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'The Origins Centre is a museum.' ORDER BY question_id LIMIT 1), 'False', FALSE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Origins Centre' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'The Origins Centre is a museum.' ORDER BY question_id LIMIT 1) AND body = 'False');

INSERT INTO trivia_questions (event_id, format, body, time_limit_s, difficulty)
SELECT (SELECT event_id FROM events WHERE title = 'Origins Centre' AND is_procedural = FALSE ORDER BY event_id LIMIT 1), 'FILL_BLANK', 'Ancient paintings made on rock surfaces are called rock ____.', 30, 1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Origins Centre' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'Ancient paintings made on rock surfaces are called rock ____.');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Origins Centre' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'Ancient paintings made on rock surfaces are called rock ____.' ORDER BY question_id LIMIT 1), 'art', TRUE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Origins Centre' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'Ancient paintings made on rock surfaces are called rock ____.' ORDER BY question_id LIMIT 1) AND body = 'art');

-- ── Wits Science Stadium ──────────────────────────────
INSERT INTO events (title, description, latitude, longitude, radius_meters, point_reward, is_active, author_id, curation_status, published_at)
SELECT 'Wits Science Stadium', 'The Wits Science Stadium on West Campus, a teaching hub for science students.', -26.19070900, 28.02561100, 40, 15, TRUE, COALESCE((SELECT MIN(user_id) FROM admin_roles WHERE role = 'SUPER_ADMIN'), (SELECT MIN(user_id) FROM users)), 'PUBLISHED', UTC_TIMESTAMP()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM events WHERE title = 'Wits Science Stadium' AND is_procedural = FALSE);

INSERT INTO trivia_questions (event_id, format, body, time_limit_s, difficulty)
SELECT (SELECT event_id FROM events WHERE title = 'Wits Science Stadium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1), 'TRUE_FALSE', 'The Wits Science Stadium is on Wits West Campus.', 30, 1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Wits Science Stadium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'The Wits Science Stadium is on Wits West Campus.');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Wits Science Stadium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'The Wits Science Stadium is on Wits West Campus.' ORDER BY question_id LIMIT 1), 'True', TRUE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Wits Science Stadium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'The Wits Science Stadium is on Wits West Campus.' ORDER BY question_id LIMIT 1) AND body = 'True');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Wits Science Stadium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'The Wits Science Stadium is on Wits West Campus.' ORDER BY question_id LIMIT 1), 'False', FALSE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Wits Science Stadium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'The Wits Science Stadium is on Wits West Campus.' ORDER BY question_id LIMIT 1) AND body = 'False');

INSERT INTO trivia_questions (event_id, format, body, time_limit_s, difficulty)
SELECT (SELECT event_id FROM events WHERE title = 'Wits Science Stadium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1), 'MULTIPLE_CHOICE', 'What is H2O more commonly called?', 30, 1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Wits Science Stadium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'What is H2O more commonly called?');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Wits Science Stadium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'What is H2O more commonly called?' ORDER BY question_id LIMIT 1), 'Salt', FALSE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Wits Science Stadium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'What is H2O more commonly called?' ORDER BY question_id LIMIT 1) AND body = 'Salt');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Wits Science Stadium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'What is H2O more commonly called?' ORDER BY question_id LIMIT 1), 'Water', TRUE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Wits Science Stadium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'What is H2O more commonly called?' ORDER BY question_id LIMIT 1) AND body = 'Water');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Wits Science Stadium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'What is H2O more commonly called?' ORDER BY question_id LIMIT 1), 'Oxygen', FALSE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Wits Science Stadium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'What is H2O more commonly called?' ORDER BY question_id LIMIT 1) AND body = 'Oxygen');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Wits Science Stadium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'What is H2O more commonly called?' ORDER BY question_id LIMIT 1), 'Sugar', FALSE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Wits Science Stadium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'What is H2O more commonly called?' ORDER BY question_id LIMIT 1) AND body = 'Sugar');

INSERT INTO trivia_questions (event_id, format, body, time_limit_s, difficulty)
SELECT (SELECT event_id FROM events WHERE title = 'Wits Science Stadium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1), 'FILL_BLANK', 'The chemical symbol for gold is ____.', 30, 1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Wits Science Stadium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'The chemical symbol for gold is ____.');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Wits Science Stadium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'The chemical symbol for gold is ____.' ORDER BY question_id LIMIT 1), 'Au', TRUE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Wits Science Stadium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'The chemical symbol for gold is ____.' ORDER BY question_id LIMIT 1) AND body = 'Au');

INSERT INTO trivia_questions (event_id, format, body, time_limit_s, difficulty)
SELECT (SELECT event_id FROM events WHERE title = 'Wits Science Stadium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1), 'MULTIPLE_CHOICE', 'At sea level, pure water boils at how many degrees Celsius?', 30, 1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Wits Science Stadium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'At sea level, pure water boils at how many degrees Celsius?');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Wits Science Stadium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'At sea level, pure water boils at how many degrees Celsius?' ORDER BY question_id LIMIT 1), '50', FALSE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Wits Science Stadium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'At sea level, pure water boils at how many degrees Celsius?' ORDER BY question_id LIMIT 1) AND body = '50');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Wits Science Stadium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'At sea level, pure water boils at how many degrees Celsius?' ORDER BY question_id LIMIT 1), '90', FALSE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Wits Science Stadium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'At sea level, pure water boils at how many degrees Celsius?' ORDER BY question_id LIMIT 1) AND body = '90');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Wits Science Stadium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'At sea level, pure water boils at how many degrees Celsius?' ORDER BY question_id LIMIT 1), '100', TRUE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Wits Science Stadium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'At sea level, pure water boils at how many degrees Celsius?' ORDER BY question_id LIMIT 1) AND body = '100');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Wits Science Stadium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'At sea level, pure water boils at how many degrees Celsius?' ORDER BY question_id LIMIT 1), '212', FALSE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Wits Science Stadium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'At sea level, pure water boils at how many degrees Celsius?' ORDER BY question_id LIMIT 1) AND body = '212');

-- ── Johannesburg Planetarium ──────────────────────────────
INSERT INTO events (title, description, latitude, longitude, radius_meters, point_reward, is_active, author_id, curation_status, published_at)
SELECT 'Johannesburg Planetarium', 'The Johannesburg Planetarium, run by Wits University.', -26.18871000, 28.02817400, 40, 15, TRUE, COALESCE((SELECT MIN(user_id) FROM admin_roles WHERE role = 'SUPER_ADMIN'), (SELECT MIN(user_id) FROM users)), 'PUBLISHED', UTC_TIMESTAMP()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM events WHERE title = 'Johannesburg Planetarium' AND is_procedural = FALSE);

INSERT INTO trivia_questions (event_id, format, body, time_limit_s, difficulty)
SELECT (SELECT event_id FROM events WHERE title = 'Johannesburg Planetarium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1), 'TRUE_FALSE', 'The Johannesburg Planetarium is run by Wits University.', 30, 1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Johannesburg Planetarium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'The Johannesburg Planetarium is run by Wits University.');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Johannesburg Planetarium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'The Johannesburg Planetarium is run by Wits University.' ORDER BY question_id LIMIT 1), 'True', TRUE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Johannesburg Planetarium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'The Johannesburg Planetarium is run by Wits University.' ORDER BY question_id LIMIT 1) AND body = 'True');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Johannesburg Planetarium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'The Johannesburg Planetarium is run by Wits University.' ORDER BY question_id LIMIT 1), 'False', FALSE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Johannesburg Planetarium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'The Johannesburg Planetarium is run by Wits University.' ORDER BY question_id LIMIT 1) AND body = 'False');

INSERT INTO trivia_questions (event_id, format, body, time_limit_s, difficulty)
SELECT (SELECT event_id FROM events WHERE title = 'Johannesburg Planetarium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1), 'MULTIPLE_CHOICE', 'Which planet is known as the Red Planet?', 30, 1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Johannesburg Planetarium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'Which planet is known as the Red Planet?');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Johannesburg Planetarium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'Which planet is known as the Red Planet?' ORDER BY question_id LIMIT 1), 'Venus', FALSE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Johannesburg Planetarium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'Which planet is known as the Red Planet?' ORDER BY question_id LIMIT 1) AND body = 'Venus');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Johannesburg Planetarium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'Which planet is known as the Red Planet?' ORDER BY question_id LIMIT 1), 'Mars', TRUE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Johannesburg Planetarium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'Which planet is known as the Red Planet?' ORDER BY question_id LIMIT 1) AND body = 'Mars');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Johannesburg Planetarium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'Which planet is known as the Red Planet?' ORDER BY question_id LIMIT 1), 'Jupiter', FALSE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Johannesburg Planetarium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'Which planet is known as the Red Planet?' ORDER BY question_id LIMIT 1) AND body = 'Jupiter');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Johannesburg Planetarium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'Which planet is known as the Red Planet?' ORDER BY question_id LIMIT 1), 'Saturn', FALSE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Johannesburg Planetarium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'Which planet is known as the Red Planet?' ORDER BY question_id LIMIT 1) AND body = 'Saturn');

INSERT INTO trivia_questions (event_id, format, body, time_limit_s, difficulty)
SELECT (SELECT event_id FROM events WHERE title = 'Johannesburg Planetarium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1), 'MULTIPLE_CHOICE', 'How many planets are in our Solar System?', 30, 1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Johannesburg Planetarium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'How many planets are in our Solar System?');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Johannesburg Planetarium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'How many planets are in our Solar System?' ORDER BY question_id LIMIT 1), '7', FALSE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Johannesburg Planetarium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'How many planets are in our Solar System?' ORDER BY question_id LIMIT 1) AND body = '7');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Johannesburg Planetarium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'How many planets are in our Solar System?' ORDER BY question_id LIMIT 1), '8', TRUE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Johannesburg Planetarium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'How many planets are in our Solar System?' ORDER BY question_id LIMIT 1) AND body = '8');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Johannesburg Planetarium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'How many planets are in our Solar System?' ORDER BY question_id LIMIT 1), '9', FALSE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Johannesburg Planetarium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'How many planets are in our Solar System?' ORDER BY question_id LIMIT 1) AND body = '9');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Johannesburg Planetarium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'How many planets are in our Solar System?' ORDER BY question_id LIMIT 1), '10', FALSE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Johannesburg Planetarium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'How many planets are in our Solar System?' ORDER BY question_id LIMIT 1) AND body = '10');

INSERT INTO trivia_questions (event_id, format, body, time_limit_s, difficulty)
SELECT (SELECT event_id FROM events WHERE title = 'Johannesburg Planetarium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1), 'FILL_BLANK', 'The star at the centre of our Solar System is called the ____.', 30, 1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Johannesburg Planetarium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'The star at the centre of our Solar System is called the ____.');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Johannesburg Planetarium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'The star at the centre of our Solar System is called the ____.' ORDER BY question_id LIMIT 1), 'Sun', TRUE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'Johannesburg Planetarium' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'The star at the centre of our Solar System is called the ____.' ORDER BY question_id LIMIT 1) AND body = 'Sun');

-- ── The Matrix ──────────────────────────────
INSERT INTO events (title, description, latitude, longitude, radius_meters, point_reward, is_active, author_id, curation_status, published_at)
SELECT 'The Matrix', 'The Matrix, the Wits student centre on East Campus.', -26.18960500, 28.03085200, 40, 15, TRUE, COALESCE((SELECT MIN(user_id) FROM admin_roles WHERE role = 'SUPER_ADMIN'), (SELECT MIN(user_id) FROM users)), 'PUBLISHED', UTC_TIMESTAMP()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM events WHERE title = 'The Matrix' AND is_procedural = FALSE);

INSERT INTO trivia_questions (event_id, format, body, time_limit_s, difficulty)
SELECT (SELECT event_id FROM events WHERE title = 'The Matrix' AND is_procedural = FALSE ORDER BY event_id LIMIT 1), 'TRUE_FALSE', 'The Matrix is a Wits student centre with places to eat.', 30, 1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'The Matrix' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'The Matrix is a Wits student centre with places to eat.');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'The Matrix' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'The Matrix is a Wits student centre with places to eat.' ORDER BY question_id LIMIT 1), 'True', TRUE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'The Matrix' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'The Matrix is a Wits student centre with places to eat.' ORDER BY question_id LIMIT 1) AND body = 'True');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'The Matrix' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'The Matrix is a Wits student centre with places to eat.' ORDER BY question_id LIMIT 1), 'False', FALSE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'The Matrix' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'The Matrix is a Wits student centre with places to eat.' ORDER BY question_id LIMIT 1) AND body = 'False');

INSERT INTO trivia_questions (event_id, format, body, time_limit_s, difficulty)
SELECT (SELECT event_id FROM events WHERE title = 'The Matrix' AND is_procedural = FALSE ORDER BY event_id LIMIT 1), 'MULTIPLE_CHOICE', 'In which Johannesburg suburb is the Wits main campus?', 30, 1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'The Matrix' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'In which Johannesburg suburb is the Wits main campus?');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'The Matrix' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'In which Johannesburg suburb is the Wits main campus?' ORDER BY question_id LIMIT 1), 'Braamfontein', TRUE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'The Matrix' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'In which Johannesburg suburb is the Wits main campus?' ORDER BY question_id LIMIT 1) AND body = 'Braamfontein');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'The Matrix' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'In which Johannesburg suburb is the Wits main campus?' ORDER BY question_id LIMIT 1), 'Sandton', FALSE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'The Matrix' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'In which Johannesburg suburb is the Wits main campus?' ORDER BY question_id LIMIT 1) AND body = 'Sandton');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'The Matrix' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'In which Johannesburg suburb is the Wits main campus?' ORDER BY question_id LIMIT 1), 'Soweto', FALSE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'The Matrix' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'In which Johannesburg suburb is the Wits main campus?' ORDER BY question_id LIMIT 1) AND body = 'Soweto');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'The Matrix' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'In which Johannesburg suburb is the Wits main campus?' ORDER BY question_id LIMIT 1), 'Rosebank', FALSE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'The Matrix' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'In which Johannesburg suburb is the Wits main campus?' ORDER BY question_id LIMIT 1) AND body = 'Rosebank');

INSERT INTO trivia_questions (event_id, format, body, time_limit_s, difficulty)
SELECT (SELECT event_id FROM events WHERE title = 'The Matrix' AND is_procedural = FALSE ORDER BY event_id LIMIT 1), 'FILL_BLANK', 'When students finish their degree they attend a ____ ceremony.', 30, 1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'The Matrix' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'When students finish their degree they attend a ____ ceremony.');

INSERT INTO trivia_options (question_id, body, is_correct)
SELECT (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'The Matrix' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'When students finish their degree they attend a ____ ceremony.' ORDER BY question_id LIMIT 1), 'graduation', TRUE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM trivia_options WHERE question_id = (SELECT question_id FROM trivia_questions WHERE event_id = (SELECT event_id FROM events WHERE title = 'The Matrix' AND is_procedural = FALSE ORDER BY event_id LIMIT 1) AND body = 'When students finish their degree they attend a ____ ceremony.' ORDER BY question_id LIMIT 1) AND body = 'graduation');
