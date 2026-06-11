#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
export PG_DIVERGE_COMPARE_DATABASE_URL=${PG_DIVERGE_COMPARE_DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}
export PG_DIVERGE_COMPARE_WARMUPS=1
export PG_DIVERGE_COMPARE_TIMEOUT_MS=480000

run_small() {
  PG_DIVERGE_COMPARE_FIXTURES=additive,functions-policies PG_DIVERGE_COMPARE_ITERATIONS=3 \
    PG_DIVERGE_COMPARE_PORT_BASE=55400 \
    PG_DIVERGE_COMPARE_OUT=benchmarks/results/comparison.json node benchmarks/compare.js >/dev/null
  echo "DONE small-fixtures"
}
run_realistic() {
  PG_DIVERGE_COMPARE_FIXTURES=realistic PG_DIVERGE_COMPARE_ITERATIONS=3 \
    PG_DIVERGE_COMPARE_PORT_BASE=56400 \
    PG_DIVERGE_COMPARE_OUT=benchmarks/results/comparison-realistic.json node benchmarks/compare.js >/dev/null
  echo "DONE realistic"
}
run_xl() {
  PG_DIVERGE_COMPARE_XL_TABLES=1000 PG_DIVERGE_COMPARE_FIXTURES=xl PG_DIVERGE_COMPARE_ITERATIONS=3 \
    PG_DIVERGE_COMPARE_PORT_BASE=57400 \
    PG_DIVERGE_COMPARE_OUT=benchmarks/results/comparison-xl.json node benchmarks/compare.js >/dev/null
  echo "DONE xl"
}
run_xxl() {
  PG_DIVERGE_COMPARE_XXL_TABLES=2500 PG_DIVERGE_COMPARE_FIXTURES=xxl PG_DIVERGE_COMPARE_ITERATIONS=1 \
    PG_DIVERGE_COMPARE_PORT_BASE=58400 \
    PG_DIVERGE_COMPARE_OUT=benchmarks/results/comparison-xxl.json node benchmarks/compare.js >/dev/null
  echo "DONE xxl"
}

if [ "${BENCH_ALL_SEQUENTIAL:-0}" = "1" ]; then
  run_small
  run_realistic
  run_xl
  run_xxl
else
  run_small &
  run_realistic &
  run_xl &
  run_xxl &
  wait
fi

node benchmarks/plot.js benchmarks/results/comparison.json benchmarks/results/comparison-realistic.json \
  benchmarks/results/comparison-xl.json benchmarks/results/comparison-xxl.json >/dev/null
cp benchmarks/results/*-latency.svg benchmarks/results/*-correctness.svg docs/benchmarks/
echo "DONE plot-and-charts"
