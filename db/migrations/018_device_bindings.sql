-- KickStock · Migration 018 · Device bindings (anti-usurpation device_id)
--
-- Contexte : POST /api/auth/device-init signait n'importe quel device_id v4
-- fourni par le client sans vérifier qu'il appartenait légitimement à
-- l'appelant. Un attaquant ayant observé le device_id d'une victime pouvait
-- obtenir un cookie HttpOnly signé valide pour ce device_id depuis un
-- navigateur vierge, puis usurper son identité sur /api/trade,
-- /api/game/state, /api/game/advance, /api/game/reset.
--
-- Fix (option B du ticket sécurité "device-init binding", recommandée par
-- l'équipe sécurité) : verrouiller le device_id au premier signataire. Cette
-- table mémorise une empreinte non réversible (hash salé via HMAC secret) du
-- réseau et du navigateur ayant initié la première signature — JAMAIS l'IP
-- en clair. Toute nouvelle tentative de signature pour ce device_id, depuis
-- une empreinte radicalement différente (réseau ET navigateur à la fois), est
-- rejetée par la route avec 409 device_already_bound.
--
-- Run AFTER 001–017.

CREATE TABLE IF NOT EXISTS device_bindings (
  device_id     UUID        PRIMARY KEY,
  first_ip_hash TEXT        NOT NULL,
  first_ua_hash TEXT        NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS activée sans policy : seule la clé de service (admin client, qui
-- contourne RLS côté serveur) peut lire/écrire cette table. Aucun accès
-- anonyme ou authentifié direct — la table n'est jamais exposée au client.
ALTER TABLE device_bindings ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE device_bindings IS
  'Verrou anti-usurpation device_id : empreinte hashée (jamais en clair) du premier signataire de chaque device_id. Cf. ticket sécurité device-init binding.';
