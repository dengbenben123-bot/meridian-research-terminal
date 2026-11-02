PRAGMA foreign_keys = ON;
CREATE TABLE users (
 id TEXT PRIMARY KEY,
 email TEXT NOT NULL UNIQUE COLLATE NOCASE,
 display_name TEXT NOT NULL,
 password_hash TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE TABLE sessions (
 token_hash TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 csrf_hash TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id, created_at);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE posts (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title TEXT NOT NULL,
 body TEXT NOT NULL,
 visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','public')),
 version INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX posts_owner ON posts(owner_id, updated_at DESC);
CREATE INDEX posts_public ON posts(visibility, updated_at DESC);
CREATE VIRTUAL TABLE posts_fts USING fts5(title, body, content='posts', content_rowid='rowid', tokenize='unicode61');
CREATE TRIGGER posts_ai AFTER INSERT ON posts BEGIN
 INSERT INTO posts_fts(rowid,title,body) VALUES(new.rowid,new.title,new.body);
END;
CREATE TRIGGER posts_ad AFTER DELETE ON posts BEGIN
 INSERT INTO posts_fts(posts_fts,rowid,title,body) VALUES('delete',old.rowid,old.title,old.body);
END;
CREATE TRIGGER posts_au AFTER UPDATE OF title,body ON posts BEGIN
 INSERT INTO posts_fts(posts_fts,rowid,title,body) VALUES('delete',old.rowid,old.title,old.body);
 INSERT INTO posts_fts(rowid,title,body) VALUES(new.rowid,new.title,new.body);
END;
CREATE TABLE files (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 object_key TEXT NOT NULL UNIQUE,
 filename TEXT NOT NULL,
 mime TEXT NOT NULL,
 bytes INTEGER NOT NULL CHECK(bytes > 0),
 visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','public')),
 status TEXT NOT NULL CHECK(status IN ('pending','ready')),
 created_at INTEGER NOT NULL
);
CREATE INDEX files_owner ON files(owner_id, status);
CREATE TABLE watchlist (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 symbol TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,symbol)
);
