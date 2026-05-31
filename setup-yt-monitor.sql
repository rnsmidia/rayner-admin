-- Cache de buscas YouTube (evita re-chamar a API para o mesmo termo)
CREATE TABLE IF NOT EXISTS yt_cache (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  cache_key   text        NOT NULL,
  result_json jsonb       NOT NULL,
  hits        integer     DEFAULT 0,
  created_at  timestamptz DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS yt_cache_key_idx ON yt_cache(cache_key);
CREATE INDEX IF NOT EXISTS yt_cache_expires_idx   ON yt_cache(expires_at);

-- Log de chamadas à YouTube Data API
CREATE TABLE IF NOT EXISTS yt_api_log (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  key_index  smallint    NOT NULL,   -- 1 = key principal, 2 = key reserva
  action     text        NOT NULL,   -- 'search_videos' | 'search_channels'
  query      text,
  units      smallint    NOT NULL,   -- unidades consumidas nessa chamada
  cache_hit  boolean     DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS yt_api_log_created_idx ON yt_api_log(created_at DESC);
