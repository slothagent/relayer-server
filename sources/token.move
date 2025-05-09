module 0x0::TokenFTS {
    struct TOKENFTS has drop {}
    
    fun init(witness: TOKENFTS, ctx: &mut 0x2::tx_context::TxContext) {
        let (treasury_cap, metadata) = 0x2::coin::create_currency<TOKENFTS>(
            witness,
            9,
            b"TFTS",
            b"TokenFTS",
            b"TokenFT Custom Token",
            0x1::option::some<0x2::url::Url>(0x2::url::new_unsafe_from_bytes(b"https://imageio.forbes.com/specials-images/imageserve/6170e01f8d7639b95a7f2eeb/Sotheby-s-NFT-Natively-Digital-1-2-sale-Bored-Ape-Yacht-Club--8817-by-Yuga-Labs/0x0.png?format=png&width=960")),
            ctx
        );
        
        0x2::transfer::public_freeze_object<0x2::coin::CoinMetadata<TOKENFTS>>(metadata);
        0x2::transfer::public_transfer<0x2::coin::Coin<TOKENFTS>>(
            0x2::coin::mint<TOKENFTS>(&mut treasury_cap, 1000000000000000000, ctx),
            0x2::tx_context::sender(ctx)
        );
        0x2::transfer::public_freeze_object<0x2::coin::TreasuryCap<TOKENFTS>>(treasury_cap);
    }
}