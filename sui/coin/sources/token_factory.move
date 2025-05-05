module 0x0::token_factory {
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::coin::Self;
    use sui::url;
    use std::option;
    use std::vector;
    use sui::event;
    use sui::object;
    use 0x1::ascii::String;
    use 0x1::string::String;
    use 0x2::object::ID;

    /// Error codes
    const ENonZeroDecimals: u64 = 0;
    const EInvalidSymbolLength: u64 = 1;

    /// Event struct for created token
    struct CreatedEvent has copy, drop, store {
        name: 0x1::ascii::String,
        symbol: 0x1::ascii::String,
        uri: 0x1::ascii::String,
        description: 0x1::string::String,
        twitter: 0x1::ascii::String,
        telegram: 0x1::ascii::String,
        website: 0x1::ascii::String,
        token_address: 0x1::ascii::String,
        created_by: address,
        token_supply: u64
    }
    
    /// Custom witness type for creating new tokens
    struct MANAGED_CURRENCY_V3 has drop {}

    /// Initialize the token factory
    fun init(_ctx: &TxContext) {}

    /// Create a new token with custom parameters
    public entry fun create_token(
        decimals: u8,
        symbol: 0x1::ascii::String,
        name: 0x1::ascii::String,
        description: 0x1::ascii::String,
        url: 0x1::ascii::String,
        twitter: 0x1::ascii::String,
        telegram: 0x1::ascii::String,
        website: 0x1::ascii::String,
        uri: 0x1::ascii::String,
        initial_supply: u64,
        ctx: &mut TxContext
    ) {

        // Create the currency
        let (mut treasury_cap, metadata) = coin::create_currency(
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

        // Emit CreatedEvent
        let event = CreatedEvent {
            name: ascii::string(name),
            symbol: ascii::string(symbol),
            uri: ascii::string(uri),
            description: string::utf8(description),
            twitter: ascii::string(twitter),
            telegram: ascii::string(telegram),
            website: ascii::string(website),
            token_address: ascii::string(meta_addr),
            created_by: tx_context::sender(ctx),
            token_supply: initial_supply
        };
        event::emit(event);
    }



} 