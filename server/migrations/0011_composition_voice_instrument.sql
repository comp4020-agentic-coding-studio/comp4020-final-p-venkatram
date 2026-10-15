-- Each voice picks its own oscillator waveform at playback (labeled by the
-- instrument its timbre resembles, shared/composition.ts's INSTRUMENTS) —
-- defaults to the sine wave every existing voice already plays as.
ALTER TABLE composition_voices ADD COLUMN instrument TEXT NOT NULL DEFAULT 'sine';
