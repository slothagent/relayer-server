module token::token {
    use std::string;
    use sui::tx_context::{Self, TxContext};
    use sui::coin::{Self, Coin, TreasuryCap};
    use sui::transfer;
    use sui::package;
    use std::option;

    /// OTW to create a new coin type
    struct TOKEN has drop {}

    /// Register the token to get the `TreasuryCap` for the coin
    fun init(witness: TOKEN, ctx: &mut TxContext) {
        let (treasury_cap, metadata) = coin::create_currency(
            witness,
            9, // decimals
            b"TOKEN", // symbol
            b"Token", // name
            b"", // description
            option::none(), // icon url
            ctx
        );

        transfer::public_transfer(treasury_cap, tx_context::sender(ctx))
    }

    /// Create new coin with custom params
    public fun create_coin(
        name: vector<u8>,
        symbol: vector<u8>,
        description: vector<u8>,
        decimals: u8,
        ctx: &mut TxContext
    ): (TreasuryCap<TOKEN>, coin::CoinMetadata<TOKEN>) {
        let (treasury_cap, metadata) = coin::create_currency(
            TOKEN {},
            decimals,
            symbol,
            name,
            description,
            option::none(),
            ctx
        );

        (treasury_cap, metadata)
    }

    /// Mint more coins
    public entry fun mint(
        treasury_cap: &mut TreasuryCap<TOKEN>,
        amount: u64,
        recipient: address,
        ctx: &mut TxContext
    ) {
        let coin = coin::mint(treasury_cap, amount, ctx);
        transfer::public_transfer(coin, recipient);
    }

    /// Burn coins
    public entry fun burn(
        treasury_cap: &mut TreasuryCap<TOKEN>,
        coin: Coin<TOKEN>
    ) {
        coin::burn(treasury_cap, coin);
    }
} 