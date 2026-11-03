ALTER TABLE conversations ADD COLUMN private_pair text UNIQUE;
ALTER TABLE messages ALTER COLUMN encrypted_content DROP NOT NULL;
ALTER TABLE messages ALTER COLUMN key_version DROP NOT NULL;
ALTER TABLE messages ADD COLUMN content text CHECK (char_length(content) BETWEEN 1 AND 1000 AND length(btrim(content)) > 0);
ALTER TABLE messages ADD COLUMN client_id uuid;
CREATE UNIQUE INDEX messages_retry_idx ON messages(sender_id, client_id);
