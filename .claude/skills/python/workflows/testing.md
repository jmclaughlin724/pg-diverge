<required_reading> Read:

1. `references/python-standards.md`
2. `references/tooling-templates.md` </required_reading>

<process>
1. Start with the behavior contract: inputs, outputs, errors, state changes, external effects, and invariants.
2. Use pytest tests with direct assertions. Keep fixtures explicit, modular, and scoped as narrowly as possible.
3. Use parametrization for examples that share the same behavior. Give complex cases readable ids.
4. Use factory fixtures when a test needs multiple instances with small variations.
5. Mock only process boundaries: network, filesystem, clock, subprocess, randomness, or third-party services. Do not mock the unit under test.
6. Add Hypothesis when the behavior has useful invariants, round trips, ordering properties, parser/serializer contracts, numeric boundaries, or user-input shape variation.
7. Treat coverage as a signal, not a goal by itself. Raise coverage when important behavior is untested; do not write shallow tests just to hit a number.
8. Verify with focused tests first, then run broader suites when shared code or fixtures changed.
</process>

<success_criteria>

- Tests fail for the bug or missing behavior before the fix when feasible.
- Fixtures are understandable from the test signature and do not create hidden global coupling.
- Property tests use bounded, domain-valid strategies and preserve reproducibility.
- The chosen test command passes. </success_criteria>
