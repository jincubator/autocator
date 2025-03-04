-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Compacts table for storing compact messages and their metadata
CREATE TABLE compacts (
    id UUID PRIMARY KEY,
    chain_id bigint NOT NULL,
    claim_hash bytea NOT NULL CHECK (length(claim_hash) = 32),
    arbiter bytea NOT NULL CHECK (length(arbiter) = 20),
    sponsor bytea NOT NULL CHECK (length(sponsor) = 20),
    nonce bytea NOT NULL CHECK (length(nonce) = 32),
    expires BIGINT NOT NULL,
    lock_id bytea NOT NULL CHECK (length(lock_id) = 32),
    amount bytea NOT NULL CHECK (length(amount) = 32),
    witness_type_string TEXT,
    witness_hash bytea CHECK (witness_hash IS NULL OR length(witness_hash) = 32),
    signature bytea NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(chain_id, claim_hash)
);

-- Nonces table for tracking consumed nonces
CREATE TABLE nonces (
    id UUID PRIMARY KEY,
    chain_id bigint NOT NULL,
    sponsor bytea NOT NULL CHECK (length(sponsor) = 20),
    nonce_high bigint NOT NULL,
    nonce_low integer NOT NULL,
    consumed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(chain_id, sponsor, nonce_high, nonce_low)
);

-- Create indexes for common query patterns
CREATE INDEX idx_compacts_sponsor ON compacts(sponsor);
CREATE INDEX idx_compacts_chain_claim ON compacts(chain_id, claim_hash);
CREATE INDEX idx_nonces_chain_sponsor ON nonces(chain_id, sponsor);
