# Review And Training Architecture

## Product Contract

Mistake Lab, Drill Mode, and Analysis Board are three separate jobs.

## Mistake Lab: Understand

Goal: explain a mistake after the game.

- Shows the position, the played move, and the immediate consequence as a three-step story.
- Shows engine evidence as supporting proof, not as the primary interaction.
- Provides a clear coach note and one action: train this pattern.
- The board is not a puzzle surface here. Users are reviewing, not being tested.

## Drill Mode: Practice

Goal: build recall from the user's own mistakes and same-theme positions.

- Attempt-first. The best move is hidden on load.
- No engine readout or best-move arrow before the user commits.
- Wrong answer resets to the same starting position.
- Hints escalate: first a thinking process, then the move.
- The queue is grouped by recurring pattern so practice feels like a focused set, not random review.

## Analysis Board: Explore

Goal: free analysis from a position.

- The board starts in human-analysis mode.
- Engine lines and arrows are opt-in.
- No automatic engine replies.
- User moves are logged so exploration stays understandable.

## Reference Behaviors

- Chess.com separates Game Review explanations from optional Analysis engine settings.
- Lichess Learn From Mistakes makes users retry critical positions.
- Lichess interactive lessons give instructions, hints, and feedback rather than showing the answer immediately.
- Chessable-style training favors repeated recall over passive explanation.
