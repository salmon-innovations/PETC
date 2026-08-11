# Center-level CEC pricing

The platform-wide default remains `wallet.charge_per_upload_centavos` in the
portal Settings page. Each center may either inherit that live default or set a
nullable `cec_charge_override_centavos` value from its Center Wallet page.

Money is stored and transported as integer centavos. A zero override is valid;
a null override means “use platform default.” Changing the platform default
therefore affects centers without an override and leaves custom centers alone.

When the cloud first receives a submission, it copies the center's effective
price into `submissions.charge_snapshot_centavos`. Queued, held, retried, and
grace-released submissions retain that quote. A corrected resubmission after a
definitive rejection receives a new quote. LTMS rejections are not charged.

The same immutable quote is used for the pre-dispatch affordability check,
FIFO release of held submissions, and the accepted-CEC wallet debit. Pricing
changes write a `CENTER_CEC_CHARGE_CHANGED` audit event, and the quoted amount
is visible in the portal's submission detail panel.
