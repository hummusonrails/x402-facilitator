// Error reason codes returned in `invalidReason` / `errorReason`.
// Protocol-level codes come from the x402 v2 specification (section 9).
// Scheme-level codes match the reference exact EVM facilitator
// (x402-foundation/x402 typescript/packages/mechanisms/evm/src/exact/facilitator/errors.ts)
// so clients see identical strings regardless of which facilitator they talk to.

// Protocol
export const ErrInsufficientFunds = 'insufficient_funds';
export const ErrInvalidNetwork = 'invalid_network';
export const ErrInvalidPayload = 'invalid_payload';
export const ErrInvalidPaymentRequirements = 'invalid_payment_requirements';
export const ErrUnsupportedScheme = 'unsupported_scheme';
export const ErrInvalidX402Version = 'invalid_x402_version';
export const ErrInvalidTransactionState = 'invalid_transaction_state';
export const ErrUnexpectedVerifyError = 'unexpected_verify_error';
export const ErrUnexpectedSettleError = 'unexpected_settle_error';
export const ErrSettlementPending = 'settlement_pending';

// Exact EVM scheme
export const ErrInvalidScheme = 'invalid_exact_evm_scheme';
export const ErrNetworkMismatch = 'invalid_exact_evm_network_mismatch';
export const ErrMissingEip712Domain = 'invalid_exact_evm_missing_eip712_domain';
export const ErrRecipientMismatch = 'invalid_exact_evm_recipient_mismatch';
export const ErrInvalidSignature = 'invalid_exact_evm_signature';
export const ErrValidBeforeExpired = 'invalid_exact_evm_payload_authorization_valid_before';
export const ErrValidAfterInFuture = 'invalid_exact_evm_payload_authorization_valid_after';
export const ErrAuthorizationValueMismatch = 'invalid_exact_evm_payload_authorization_value_mismatch';
export const ErrTokenNameMismatch = 'invalid_exact_evm_token_name_mismatch';
export const ErrTokenVersionMismatch = 'invalid_exact_evm_token_version_mismatch';
export const ErrNonceAlreadyUsed = 'invalid_exact_evm_nonce_already_used';
export const ErrInsufficientBalance = 'invalid_exact_evm_insufficient_balance';
export const ErrSimulationFailed = 'invalid_exact_evm_transaction_simulation_failed';
export const ErrTransactionFailed = 'invalid_exact_evm_transaction_failed';
export const ErrTransferEventMismatch = 'invalid_exact_evm_transfer_event_mismatch';
export const ErrUnsupportedAssetTransferMethod = 'unsupported_payload_type';

// Facilitator-specific (fee split model and merchant accounts)
export const ErrUnsupportedAsset = 'unsupported_asset';
export const ErrAmountBelowFee = 'amount_below_facilitator_fee';
export const ErrAmountAboveLimit = 'amount_above_facilitator_limit';
export const ErrMerchantNotRegistered = 'merchant_not_registered';
export const ErrMerchantDisabled = 'merchant_disabled';
