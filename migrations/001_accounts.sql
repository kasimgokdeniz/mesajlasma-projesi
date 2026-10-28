CREATE TABLE users (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username varchar(32) NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_]{3,32}$'),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE conversations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('private', 'group')),
  name varchar(100),
  created_by bigint NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE conversation_members (
  conversation_id bigint NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX conversation_members_user_idx ON conversation_members(user_id);
CREATE TABLE messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id bigint NOT NULL REFERENCES conversations(id),
  sender_id bigint NOT NULL REFERENCES users(id),
  encrypted_content jsonb NOT NULL,
  key_version integer NOT NULL CHECK (key_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (conversation_id, sender_id) REFERENCES conversation_members(conversation_id, user_id)
);
CREATE INDEX messages_history_idx ON messages(conversation_id, id);
CREATE TABLE user_public_keys (
  user_id bigint NOT NULL REFERENCES users(id),
  key_version integer NOT NULL CHECK (key_version > 0),
  public_key jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key_version)
);
CREATE TABLE key_envelopes (
  conversation_id bigint NOT NULL REFERENCES conversations(id),
  recipient_id bigint NOT NULL REFERENCES users(id),
  key_version integer NOT NULL CHECK (key_version > 0),
  recipient_key_version integer NOT NULL,
  encrypted_envelope jsonb NOT NULL,
  PRIMARY KEY (conversation_id, recipient_id, key_version),
  FOREIGN KEY (conversation_id, recipient_id) REFERENCES conversation_members(conversation_id, user_id),
  FOREIGN KEY (recipient_id, recipient_key_version) REFERENCES user_public_keys(user_id, key_version)
);
CREATE TABLE writing_profiles (
  conversation_id bigint NOT NULL REFERENCES conversations(id),
  user_id bigint NOT NULL REFERENCES users(id),
  encrypted_profile jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id),
  FOREIGN KEY (conversation_id, user_id) REFERENCES conversation_members(conversation_id, user_id)
);
CREATE TABLE sessions (
  sid varchar PRIMARY KEY,
  sess json NOT NULL,
  expire timestamp NOT NULL
);
CREATE INDEX sessions_expire_idx ON sessions(expire);
