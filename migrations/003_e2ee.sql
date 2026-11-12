ALTER TABLE messages ADD CONSTRAINT messages_content_mode CHECK (
  (content IS NOT NULL AND encrypted_content IS NULL) OR
  (content IS NULL AND encrypted_content IS NOT NULL AND key_version = 1)
) NOT VALID;
