module 0x0::token_factory {
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::coin::Self;
    use sui::url;
    use std::option;
    use std::vector;
    use sui::event;
    use sui::object;

    /// Error codes
    const ENonZeroDecimals: u64 = 0;
    const EInvalidSymbolLength: u64 = 1;


    /// One-time witness for the token factory
    struct TOKEN_FACTORY has drop {}

    /// Custom witness type for creating new tokens
    struct MANAGED_CURRENCY_V3 has drop {}

    /// Initialize the token factory
    fun init(_witness: TOKEN_FACTORY, _ctx: &TxContext) {}

    /// Create a new token with custom parameters
    public entry fun create_token(
        decimals: u8,
        symbol: vector<u8>,
        name: vector<u8>,
        description: vector<u8>,
        url: vector<u8>,
        initial_supply: u64,
        ctx: &mut TxContext
    ): (address, vector<u8>, vector<u8>, vector<u8>, vector<u8>) {
        // Validate parameters
        assert!(decimals <= 9, ENonZeroDecimals);
        assert!(vector::length(&symbol) <= 10, EInvalidSymbolLength);

        // Create the currency
        let (treasury_cap, metadata) = coin::create_currency(
            MANAGED_CURRENCY_V3 {},
            decimals,
            symbol,
            name,
            description,
            option::some(url::new_unsafe_from_bytes(url)),
            ctx
        );

        // Mint initial supply cho người tạo
        let coin = coin::mint(&mut treasury_cap, initial_supply, ctx);
        transfer::public_transfer(coin, tx_context::sender(ctx));

        // Transfer the treasury cap to the creator
        transfer::public_transfer(treasury_cap, tx_context::sender(ctx));

        // Extract id and address before moving metadata
        let meta_id = object::id(&metadata);
        let meta_addr = object::id_to_address(&meta_id);

        // Freeze the metadata
        transfer::public_freeze_object(metadata);

        (meta_addr, symbol, name, description, url)
    }

} 