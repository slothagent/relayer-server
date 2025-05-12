module 0x0::Goku {
    struct GOKU has drop {}
    
    fun init(witness: GOKU, ctx: &mut 0x2::tx_context::TxContext) {
        let (treasury_cap, metadata) = 0x2::coin::create_currency<GOKU>(
            witness,
            9,
            b"GOKU",
            b"Goku",
            b"A community-driven meme token inspired by the legendary Saiyan warrior. Built for fun, speed, and scalability in Web3.",
            0x1::option::some<0x2::url::Url>(0x2::url::new_unsafe_from_bytes(b"https://i.pinimg.com/736x/87/61/57/87615753f269f77cfa2d7b43fe3f6ed9.jpg")),
            ctx
        );
        
        0x2::transfer::public_freeze_object<0x2::coin::CoinMetadata<GOKU>>(metadata);
        0x2::transfer::public_transfer<0x2::coin::Coin<GOKU>>(
            0x2::coin::mint<GOKU>(&mut treasury_cap, 1000000, ctx),
            0x2::tx_context::sender(ctx)
        );
        0x2::transfer::public_freeze_object<0x2::coin::TreasuryCap<GOKU>>(treasury_cap);
    }
}