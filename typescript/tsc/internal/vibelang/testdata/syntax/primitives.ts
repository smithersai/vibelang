function poll(work: Effect.Effect<number, never, never>) {
    {
        $uninterruptibleBlock();
        $try(work);
        {
            $restoreBlock();
            $try(work);
        }
    }
    {
        $interruptibleBlock();
        $try(work);
    }
}
