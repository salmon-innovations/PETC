-- Extend submissions with CEC presentation fields returned by LTMS:
--   or_no          : OR number that prints on the receipt (alongside cert no.)
--   dermalog_token : DERMALOG cryptographic submission seal
--   valid_from     : CEC validity start (typically test date)
--   valid_until    : CEC validity end (typically test date + 60 days)
ALTER TABLE submissions
    ADD COLUMN IF NOT EXISTS or_no          TEXT,
    ADD COLUMN IF NOT EXISTS dermalog_token TEXT,
    ADD COLUMN IF NOT EXISTS valid_from     DATE,
    ADD COLUMN IF NOT EXISTS valid_until    DATE;
