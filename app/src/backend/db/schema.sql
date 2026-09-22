SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS users (
    user_id       INT            AUTO_INCREMENT PRIMARY KEY,
    provider_id   VARCHAR(255)   NOT NULL UNIQUE,
    email         VARCHAR(255)   NOT NULL UNIQUE,
    name          VARCHAR(100)   NOT NULL,
    avatar_url    VARCHAR(500),
    points        INT            NOT NULL DEFAULT 0,
    created_at    DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_credentials (
    user_id   INT         NOT NULL PRIMARY KEY,
    pin_hash  VARCHAR(64) NOT NULL,
    CONSTRAINT fk_ucred_user FOREIGN KEY (user_id) REFERENCES users (user_id)
);
-- ============================================================
--  2. [B] ADMIN ROLES  (authoring console access)
--
--  Separates who can author events, cards, and questions from
--  regular players. A user can hold multiple roles.
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_roles (
    role_id     INT  AUTO_INCREMENT PRIMARY KEY,
    user_id     INT  NOT NULL,
    role        ENUM('SUPER_ADMIN','EVENT_AUTHOR','CARD_AUTHOR','MODERATOR') NOT NULL,
    granted_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    granted_by  INT,

    CONSTRAINT fk_ar_user      FOREIGN KEY (user_id)    REFERENCES users (user_id),
    CONSTRAINT fk_ar_grantor   FOREIGN KEY (granted_by) REFERENCES users (user_id),
    CONSTRAINT uq_ar           UNIQUE (user_id, role)
);

CREATE TABLE IF NOT EXISTS events (
    event_id          INT             AUTO_INCREMENT PRIMARY KEY,
    title             VARCHAR(255)    NOT NULL,
    description       TEXT,
    latitude          DECIMAL(10, 8)  NOT NULL,
    longitude         DECIMAL(11, 8)  NOT NULL,
    radius_meters     INT             NOT NULL DEFAULT 50,
    point_threshold   INT             NOT NULL DEFAULT 0,
    point_reward      INT             NOT NULL DEFAULT 10,
    starts_at         DATETIME,
    ends_at           DATETIME,
    repeat_interval   INT,
    attempt_cooldown_s INT            NOT NULL DEFAULT 86400,
    max_attempts_per_window INT       NOT NULL DEFAULT 1,
    is_active         BOOLEAN         NOT NULL DEFAULT TRUE,
    author_id         INT             NOT NULL,
    created_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_event_author FOREIGN KEY (author_id) REFERENCES users (user_id)
);

CREATE TABLE IF NOT EXISTS trivia_questions (
    question_id   INT          AUTO_INCREMENT PRIMARY KEY,
    event_id      INT          NOT NULL,
    format        ENUM('MULTIPLE_CHOICE','TRUE_FALSE','MULTIPLE_SELECT','FILL_BLANK') NOT NULL,
    body          TEXT         NOT NULL,
    time_limit_s  INT          NOT NULL DEFAULT 30,
    difficulty    TINYINT      NOT NULL DEFAULT 1,

    CONSTRAINT fk_question_event FOREIGN KEY (event_id) REFERENCES events (event_id)
);

CREATE TABLE IF NOT EXISTS trivia_options (
    option_id     INT      AUTO_INCREMENT PRIMARY KEY,
    question_id   INT      NOT NULL,
    body          TEXT     NOT NULL,
    is_correct    BOOLEAN  NOT NULL DEFAULT FALSE,

    CONSTRAINT fk_option_question FOREIGN KEY (question_id) REFERENCES trivia_questions (question_id)
);

CREATE TABLE IF NOT EXISTS cards (
    card_id         INT          AUTO_INCREMENT PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    flavour_text    TEXT,
    image_url       VARCHAR(500),
    category        ENUM('CHARACTER','LOCATION','INFLUENCE','HISTORICAL') NOT NULL,
    rarity          ENUM('COMMON','UNCOMMON','RARE','EPIC','LEGENDARY')                     NOT NULL,
    stat_attack     INT          NOT NULL DEFAULT 0,
    stat_location   INT          NOT NULL DEFAULT 0,
    stat_influence  INT          NOT NULL DEFAULT 0,
    stat_legacy     INT          NOT NULL DEFAULT 100,
    stat_era        INT          NOT NULL DEFAULT 0,
    ability_name    VARCHAR(100),
    ability_desc    TEXT,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
--  6. EVENT → CARD POOL
--
--  [F] global_copy_limit: total copies of this card that can
--      ever be awarded from this event across ALL players.
--      NULL = unlimited (Common). Enforces RARE/LEGENDARY scarcity.
-- ============================================================
CREATE TABLE IF NOT EXISTS event_card_pool (
    pool_id            INT  AUTO_INCREMENT PRIMARY KEY,
    event_id           INT  NOT NULL,
    card_id            INT  NOT NULL,
    weight             INT  NOT NULL DEFAULT 1,
    global_copy_limit  INT,
    copies_awarded     INT  NOT NULL DEFAULT 0,

    CONSTRAINT fk_pool_event FOREIGN KEY (event_id) REFERENCES events (event_id),
    CONSTRAINT fk_pool_card  FOREIGN KEY (card_id)  REFERENCES cards  (card_id),
    CONSTRAINT uq_pool       UNIQUE (event_id, card_id)
);

CREATE TABLE IF NOT EXISTS user_cards (
    user_card_id  INT      AUTO_INCREMENT PRIMARY KEY,
    user_id       INT      NOT NULL,
    card_id       INT      NOT NULL,
    quantity      INT      NOT NULL DEFAULT 1,
    obtained_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_uc_user FOREIGN KEY (user_id) REFERENCES users (user_id),
    CONSTRAINT fk_uc_card FOREIGN KEY (card_id) REFERENCES cards (card_id),
    CONSTRAINT uq_uc      UNIQUE (user_id, card_id)
);

-- ============================================================
--  8. [D] EVENT CARD AWARDS  — one card per event per user
--
--  The brief states a card tied to an event is awarded ONCE.
--  This table is the authoritative record of that award.
--  Before granting a card the server checks:
--    SELECT 1 FROM event_card_awards
--    WHERE user_id = ? AND event_id = ?
--  If a row exists, no card is awarded regardless of the
--  trivia result — the player still earns points for winning.
-- ============================================================
CREATE TABLE IF NOT EXISTS event_card_awards (
    award_id    INT      AUTO_INCREMENT PRIMARY KEY,
    user_id     INT      NOT NULL,
    event_id    INT      NOT NULL,
    card_id     INT      NOT NULL,
    awarded_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_eca_user  FOREIGN KEY (user_id)  REFERENCES users   (user_id),
    CONSTRAINT fk_eca_event FOREIGN KEY (event_id) REFERENCES events  (event_id),
    CONSTRAINT fk_eca_card  FOREIGN KEY (card_id)  REFERENCES cards   (card_id),
    CONSTRAINT uq_eca       UNIQUE (user_id, event_id)
);

-- ============================================================
--  9. [A] LOCATION CHECK LOG  (server-side GPS verification)
--
--  The client sends its claimed coordinates. The server
--  independently validates them using:
--    - Haversine distance vs event radius
--    - Timestamp delta (reject stale pings)
--    - Velocity check (flag impossible travel between pings)
--  This log is the audit trail for every check.
--  status = SPOOFED triggers a moderation flag.
-- ============================================================
CREATE TABLE IF NOT EXISTS location_check_log (
    check_id          INT             AUTO_INCREMENT PRIMARY KEY,
    user_id           INT             NOT NULL,
    event_id          INT             NOT NULL,
    claimed_lat       DECIMAL(10, 8)  NOT NULL,
    claimed_lng       DECIMAL(11, 8)  NOT NULL,
    distance_meters   DECIMAL(10, 2)  NOT NULL,
    status            ENUM('PENDING','VERIFIED','FAILED','SPOOFED') NOT NULL DEFAULT 'PENDING',
    prev_check_id     INT,
    travel_speed_ms   DECIMAL(8, 2),
    checked_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_lcl_user      FOREIGN KEY (user_id)      REFERENCES users            (user_id),
    CONSTRAINT fk_lcl_event     FOREIGN KEY (event_id)     REFERENCES events           (event_id),
    CONSTRAINT fk_lcl_prev      FOREIGN KEY (prev_check_id) REFERENCES location_check_log (check_id)
);

-- ============================================================
--  10. TRIVIA ATTEMPT LOG
--
--  [E] attempt_number counts attempts within the current
--      cooldown window for this user+event pair.
--      cooldown_until tells the server when the player may
--      attempt again (set = attempted_at + attempt_cooldown_s).
-- ============================================================
CREATE TABLE IF NOT EXISTS trivia_attempts (
    attempt_id        INT      AUTO_INCREMENT PRIMARY KEY,
    user_id           INT      NOT NULL,
    event_id          INT      NOT NULL,
    question_id       INT      NOT NULL,
    location_check_id INT      NOT NULL,
    is_correct        BOOLEAN  NOT NULL,
    answer_time_ms    INT      NOT NULL,
    card_awarded_id   INT,
    points_awarded    INT      NOT NULL DEFAULT 0,
    hint_used         BOOLEAN  NOT NULL DEFAULT FALSE,
    attempt_number    INT      NOT NULL DEFAULT 1,
    cooldown_until    DATETIME,
    attempted_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_ta_user     FOREIGN KEY (user_id)           REFERENCES users              (user_id),
    CONSTRAINT fk_ta_event    FOREIGN KEY (event_id)          REFERENCES events             (event_id),
    CONSTRAINT fk_ta_question FOREIGN KEY (question_id)       REFERENCES trivia_questions   (question_id),
    CONSTRAINT fk_ta_loc      FOREIGN KEY (location_check_id) REFERENCES location_check_log (check_id),
    CONSTRAINT fk_ta_card     FOREIGN KEY (card_awarded_id)   REFERENCES cards              (card_id)
);

-- ============================================================
--  11. DISCOVERED LOCATIONS  (anti-exploit gate for trading)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_discovered_events (
    user_id    INT      NOT NULL,
    event_id   INT      NOT NULL,
    first_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (user_id, event_id),
    CONSTRAINT fk_ude_user  FOREIGN KEY (user_id)  REFERENCES users  (user_id),
    CONSTRAINT fk_ude_event FOREIGN KEY (event_id) REFERENCES events (event_id)
);

-- ============================================================
--  12. [C] AUDIT LOG  (authoring console trail)
--
--  Records every create/update/delete made through the admin
--  console so changes can be reviewed and rolled back.
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_log (
    log_id        INT          AUTO_INCREMENT PRIMARY KEY,
    actor_id      INT          NOT NULL,
    action        ENUM('CREATE','UPDATE','DELETE')   NOT NULL,
    target_table  VARCHAR(64)  NOT NULL,
    target_id     INT          NOT NULL,
    before_state  JSON,
    after_state   JSON,
    changed_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_al_actor FOREIGN KEY (actor_id) REFERENCES users (user_id)
);

-- ============================================================
--  13. BATTLES
-- ============================================================
CREATE TABLE IF NOT EXISTS battles (
    battle_id     INT      AUTO_INCREMENT PRIMARY KEY,
    player1_id    INT      NOT NULL,
    player2_id    INT,
    winner_id     INT,
    status        ENUM('PENDING','ACTIVE','COMPLETED','FORFEITED','ABANDONED') NOT NULL DEFAULT 'PENDING',
    started_at    DATETIME,
    ended_at      DATETIME,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_battle_p1     FOREIGN KEY (player1_id) REFERENCES users (user_id),
    CONSTRAINT fk_battle_p2     FOREIGN KEY (player2_id) REFERENCES users (user_id),
    CONSTRAINT fk_battle_winner FOREIGN KEY (winner_id)  REFERENCES users (user_id)
);

CREATE TABLE IF NOT EXISTS battle_decks (
    deck_id       INT     AUTO_INCREMENT PRIMARY KEY,
    battle_id     INT     NOT NULL,
    user_id       INT,
    card_id       INT     NOT NULL,
    slot_position TINYINT NOT NULL,
    final_health       INT     NOT NULL DEFAULT 100,

    CONSTRAINT fk_bd_battle FOREIGN KEY (battle_id) REFERENCES battles (battle_id),
    CONSTRAINT fk_bd_user   FOREIGN KEY (user_id)   REFERENCES users   (user_id),
    CONSTRAINT fk_bd_card   FOREIGN KEY (card_id)   REFERENCES cards   (card_id),
    CONSTRAINT uq_bd_slot   UNIQUE (battle_id, user_id, slot_position)
);

CREATE TABLE IF NOT EXISTS battle_turns (
    turn_id        INT      AUTO_INCREMENT PRIMARY KEY,
    battle_id      INT      NOT NULL,
    turn_number    FLOAT      NOT NULL,
    acting_user_id INT,
    deck_slot_played_id INT      NOT NULL,
    deck_slot_targeted_id INT    NOT NULL,
    action               ENUM('ATTACK','BUFF','DEBUFF','DEFEND','DODGE','REVIVE') NOT NULL,
    damage_dealt   INT      NOT NULL DEFAULT 0,
    landed	BOOLEAN NULL,
    effect_data    JSON NULL,
    created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_bt_battle FOREIGN KEY (battle_id)             REFERENCES battles      (battle_id),
    CONSTRAINT fk_bt_user   FOREIGN KEY (acting_user_id)        REFERENCES users        (user_id),
    CONSTRAINT fk_bt_card   FOREIGN KEY (deck_slot_played_id)   REFERENCES battle_decks (deck_id),
    CONSTRAINT fk_bt_target FOREIGN KEY (deck_slot_targeted_id) REFERENCES battle_decks (deck_id)
);

-- ============================================================
--  14. TRADING
-- ============================================================
CREATE TABLE IF NOT EXISTS trades (
    trade_id          INT      AUTO_INCREMENT PRIMARY KEY,
    initiator_id      INT      NOT NULL,
    receiver_id       INT      NOT NULL,
    initiator_card_id INT      NOT NULL,
    receiver_card_id  INT      NOT NULL,
    status            ENUM('PENDING','ACCEPTED','DECLINED','CANCELLED') NOT NULL DEFAULT 'PENDING',
    created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at       DATETIME,

    CONSTRAINT fk_trade_init FOREIGN KEY (initiator_id)      REFERENCES users (user_id),
    CONSTRAINT fk_trade_recv FOREIGN KEY (receiver_id)       REFERENCES users (user_id),
    CONSTRAINT fk_trade_ic   FOREIGN KEY (initiator_card_id) REFERENCES cards (card_id),
    CONSTRAINT fk_trade_rc   FOREIGN KEY (receiver_card_id)  REFERENCES cards (card_id)
);

-- ============================================================
--  15. POINT TRANSACTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS point_transactions (
    txn_id       INT      AUTO_INCREMENT PRIMARY KEY,
    user_id      INT      NOT NULL,
    delta        INT      NOT NULL,
    reason       ENUM(
                   'TRIVIA_WIN',
                   'COSMETIC_PURCHASE',
                   'HINT_PURCHASE',
                   'INTEL_PURCHASE',
                   'REROLL_PURCHASE',
                   'CARD_SOLD',
                   'SEASON_BONUS',
                   'OTHER'
                 ) NOT NULL,
    reference_id INT,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_pt_user FOREIGN KEY (user_id) REFERENCES users (user_id)
);

-- ============================================================
--  16. COSMETICS
-- ============================================================
CREATE TABLE IF NOT EXISTS cosmetics (
    cosmetic_id  INT          AUTO_INCREMENT PRIMARY KEY,
    name         VARCHAR(255) NOT NULL,
    description  TEXT,
    type         ENUM('CARD_FRAME','BATTLE_EFFECT','AVATAR') NOT NULL,
    point_cost   INT          NOT NULL DEFAULT 0,
    image_url    VARCHAR(500)
);

CREATE TABLE IF NOT EXISTS user_cosmetics (
    user_id      INT      NOT NULL,
    cosmetic_id  INT      NOT NULL,
    obtained_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (user_id, cosmetic_id),
    CONSTRAINT fk_ucos_user FOREIGN KEY (user_id)     REFERENCES users     (user_id),
    CONSTRAINT fk_ucos_cos  FOREIGN KEY (cosmetic_id) REFERENCES cosmetics (cosmetic_id)
);

-- ============================================================
--  17. SEASONS & LEADERBOARD
-- ============================================================
CREATE TABLE IF NOT EXISTS seasons (
    season_id  INT          AUTO_INCREMENT PRIMARY KEY,
    name       VARCHAR(100) NOT NULL,
    starts_at  DATETIME     NOT NULL,
    ends_at    DATETIME     NOT NULL,
    is_active  BOOLEAN      NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS leaderboard_entries (
    entry_id   INT  AUTO_INCREMENT PRIMARY KEY,
    season_id  INT  NOT NULL,
    user_id    INT  NOT NULL,
    wins       INT  NOT NULL DEFAULT 0,
    losses     INT  NOT NULL DEFAULT 0,
    score      INT  NOT NULL DEFAULT 0,

    CONSTRAINT fk_lb_season FOREIGN KEY (season_id) REFERENCES seasons (season_id),
    CONSTRAINT fk_lb_user   FOREIGN KEY (user_id)   REFERENCES users   (user_id),
    CONSTRAINT uq_lb        UNIQUE (season_id, user_id)
);

-- ============================================================
--  18. QUESTIONS  (User Story 6 — content-author question authoring)
--
--  Stores trivia questions attached to an event in three formats:
--  MULTIPLE_CHOICE, TRUE_FALSE, FILL_BLANK.
--    - correct_answer holds the right answer (the correct option's
--      value for MULTIPLE_CHOICE, "true"/"false" for TRUE_FALSE,
--      and the expected answer text for FILL_BLANK).
--    - options is a JSON array of strings, used ONLY for
--      MULTIPLE_CHOICE (NULL for the other formats).
--  Deleting an event cascades to its questions (ON DELETE CASCADE),
--  which is the SQL equivalent of the Event -> questions relation.
-- ============================================================
CREATE TABLE IF NOT EXISTS questions (
    id             INT           AUTO_INCREMENT PRIMARY KEY,
    event_id       INT           NOT NULL,
    type           ENUM('MULTIPLE_CHOICE','TRUE_FALSE','FILL_BLANK') NOT NULL,
    text           TEXT          NOT NULL,
    correct_answer VARCHAR(500)  NOT NULL,
    options        JSON          DEFAULT NULL,
    created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_us6_question_event FOREIGN KEY (event_id)
        REFERENCES events (event_id) ON DELETE CASCADE
);

-- ============================================================
--  QR FALLBACK TOKENS  (low-accuracy GPS fallback)
-- ============================================================
CREATE TABLE IF NOT EXISTS event_qr_tokens (
    token_id    INT          AUTO_INCREMENT PRIMARY KEY,
    event_id    INT          NOT NULL,
    token       VARCHAR(64)  NOT NULL UNIQUE,
    expires_at  DATETIME     NOT NULL,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_qrt_event FOREIGN KEY (event_id) REFERENCES events (event_id) ON DELETE CASCADE
);

-- Add FALLBACK_QR to location_check_log status ENUM
ALTER TABLE location_check_log
    MODIFY COLUMN status ENUM('PENDING','VERIFIED','FAILED','SPOOFED','FALLBACK_QR') NOT NULL DEFAULT 'PENDING';

-- ============================================================
--  OFFLINE TRIVIA QUEUE LOG  (Sprint 2 — deferred verification)
--
--  Stores queued trivia attempt submissions sent from client-side
--  storage when the device reconnects. Serves as the audit ledger
--  for the /api/trivia/offline-attempts endpoint, which evaluates
--  each queued attempt against its captured client_timestamp
--  rather than the current server time.
-- ============================================================
CREATE TABLE IF NOT EXISTS offline_trivia_queue (
    queue_id            INT           AUTO_INCREMENT PRIMARY KEY,
    user_id             INT           NOT NULL,
    event_id            INT           NOT NULL,
    question_id         INT           NOT NULL,
    selected_option_id  INT           NOT NULL,
    claimed_lat         DECIMAL(10,8) NOT NULL,
    claimed_lng         DECIMAL(11,8) NOT NULL,
    client_timestamp    DATETIME      NOT NULL,
    status              ENUM(
                          'ACCEPTED',
                          'REJECTED_WINDOW_EXPIRED',
                          'REJECTED_GEOFENCE',
                          'REJECTED_WRONG_ANSWER',
                          'REJECTED_INVALID_OPTION',
                          'REJECTED_EVENT_NOT_FOUND',
                          'ERROR'
                        ) NOT NULL DEFAULT 'ACCEPTED',
    processed_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_otq_user     FOREIGN KEY (user_id)     REFERENCES users             (user_id),
    CONSTRAINT fk_otq_event    FOREIGN KEY (event_id)    REFERENCES events            (event_id),
    CONSTRAINT fk_otq_question FOREIGN KEY (question_id) REFERENCES trivia_questions  (question_id)
);

-- ============================================================
--  19. CAMPAIGNS  (curation : scheduled around term / open day)
-- ============================================================
CREATE TABLE IF NOT EXISTS campaigns (
    campaign_id   INT          AUTO_INCREMENT PRIMARY KEY,
    name          VARCHAR(255) NOT NULL,
    description   TEXT,
    term          VARCHAR(100),
    is_open_day   BOOLEAN      NOT NULL DEFAULT FALSE,
    open_day_label VARCHAR(255),
    starts_at     DATETIME,
    ends_at       DATETIME,
    status        ENUM('DRAFT','SCHEDULED','ACTIVE','ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    created_by    INT,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_campaign_author FOREIGN KEY (created_by) REFERENCES users (user_id)
);

-- ============================================================
--  20. USER TRUST SCORES  (User Story 5 — mocked trust-score table)
--
--  Mocked per-user trust scores that front the moderation queue.
--  The console's moderation view reads this table sorted by
--  trust_score (lowest first) and shows the evidence array.
--  This is a stub so the moderation UI can be built before the
--  real detection pipeline (User Story 4) lands — swap the read
--  layer (services/trust_score.js → real scorer) once ready — no
--  schema change needed.
-- ============================================================
CREATE TABLE IF NOT EXISTS user_trust_scores (
    user_id     INT             NOT NULL PRIMARY KEY,
    trust_score DECIMAL(5, 2)   NOT NULL,
    evidence    JSON,
    reason      TEXT,
    updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_uts_user FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE,
    CONSTRAINT chk_uts_score CHECK (trust_score BETWEEN 0 AND 100)
);

-- ============================================================
--  21. MODERATION ACTIONS  (User Story 5 — graduated response)
--
--  Graduated tiers: WARNING → RESTRICTION → SUSPENSION, not a
--  binary ban/no-ban. Stores who moderated whom, with evidence
--  and optional expiry. The users table carries the active
--  moderation_status for quick enforcement checks.
-- ============================================================
CREATE TABLE IF NOT EXISTS moderation_actions (
    action_id       INT         AUTO_INCREMENT PRIMARY KEY,
    target_user_id  INT         NOT NULL,
    moderator_id    INT         NOT NULL,
    action_type     ENUM('WARNING','RESTRICTION','SUSPENSION') NOT NULL,
    reason          TEXT,
    evidence        JSON,
    duration_days   INT,
    expires_at      DATETIME,
    created_at      DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_ma_target FOREIGN KEY (target_user_id) REFERENCES users (user_id) ON DELETE CASCADE,
    CONSTRAINT fk_ma_mod    FOREIGN KEY (moderator_id)   REFERENCES users (user_id)
);

SET FOREIGN_KEY_CHECKS = 1;
