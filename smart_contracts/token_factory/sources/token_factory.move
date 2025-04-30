module token_factory::factory {
    use sui::object::{Self, UID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::package;
    use sui::coin::{Self, Coin, TreasuryCap, CoinMetadata};
    use std::string::{Self, String};
    use std::vector;
    use sui::url::{Self, Url};
    use sui::event;

    /// Error codes
    const EInvalidSymbolLength: u64 = 0;
    const EInvalidDecimals: u64 = 1;
    const EInvalidSupply: u64 = 2;

    /// Token creation event
    struct TokenCreated has copy, drop {
        token_name: String,
        symbol: String,
        decimals: u8,
        description: String,
        icon_url: String,
        creator: address,
        total_supply: u64
    }

    /// Token factory capability
    struct FactoryAdmin has key {
        id: UID
    }

    /// Token registry to keep track of created tokens
    struct TokenRegistry has key {
        id: UID,
        tokens: vector<String>
    }

    /// Initialize the token factory
    fun init(ctx: &mut TxContext) {
        // Create and transfer FactoryAdmin to publisher
        transfer::transfer(
            FactoryAdmin {
                id: object::new(ctx)
            },
            tx_context::sender(ctx)
        );

        // Create and share TokenRegistry
        transfer::share_object(
            TokenRegistry {
                id: object::new(ctx),
                tokens: vector::empty()
            }
        );
    }

    /// Create a new token
    public entry fun create_token(
        _admin: &FactoryAdmin,
        name: vector<u8>,
        symbol: vector<u8>,
        description: vector<u8>,
        decimals: u8,
        icon_url: vector<u8>,
        total_supply: u64,
        registry: &mut TokenRegistry,
        ctx: &mut TxContext
    ) {
        // Validate inputs
        let symbol_str = string::utf8(symbol);
        assert!(string::length(&symbol_str) <= 10, EInvalidSymbolLength);
        assert!(decimals <= 9, EInvalidDecimals);
        assert!(total_supply > 0, EInvalidSupply);

        // Create OTW for the new token
        let witness = object::new(ctx);
        
        // Create the currency
        let (treasury_cap, metadata) = coin::create_currency(
            witness,
            decimals,
            symbol,
            name,
            description,
            option::some(url::new_unsafe_from_bytes(icon_url)),
            ctx
        );

        // Mint initial supply
        let coins = coin::mint(&mut treasury_cap, total_supply, ctx);

        // Add token to registry
        vector::push_back(&mut registry.tokens, symbol_str);

        // Emit event
        event::emit(TokenCreated {
            token_name: string::utf8(name),
            symbol: symbol_str,
            decimals,
            description: string::utf8(description),
            icon_url: string::utf8(icon_url),
            creator: tx_context::sender(ctx),
            total_supply
        });

        // Transfer treasury cap and coins to creator
        transfer::public_transfer(treasury_cap, tx_context::sender(ctx));
        transfer::public_transfer(coins, tx_context::sender(ctx));
    }

    /// Get list of created tokens
    public fun get_tokens(registry: &TokenRegistry): vector<String> {
        registry.tokens
    }

    /// Mint additional tokens (only treasury cap owner can do this)
    public entry fun mint_tokens(
        treasury_cap: &mut TreasuryCap,
        amount: u64,
        recipient: address,
        ctx: &mut TxContext
    ) {
        let coins = coin::mint(treasury_cap, amount, ctx);
        transfer::public_transfer(coins, recipient);
    }

    /// Burn tokens (only treasury cap owner can do this)
    public entry fun burn_tokens(
        treasury_cap: &mut TreasuryCap,
        coin: Coin
    ) {
        coin::burn(treasury_cap, coin);
    }

    /// Update token metadata (only treasury cap owner can do this)
    public entry fun update_token_metadata(
        treasury_cap: &TreasuryCap,
        metadata: &mut CoinMetadata,
        name: vector<u8>,
        description: vector<u8>,
        icon_url: vector<u8>,
        ctx: &mut TxContext
    ) {
        coin::update_name(metadata, string::utf8(name));
        coin::update_description(metadata, string::utf8(description));
        if (vector::length(&icon_url) > 0) {
            coin::update_icon_url(metadata, url::new_unsafe_from_bytes(icon_url));
        };
    }
} 