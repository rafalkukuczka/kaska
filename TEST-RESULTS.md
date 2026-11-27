# Visual Studio test results

The Test Explorer run summary reports **15 tests in 1.1 minutes**. **7 passed**, **6 failed**, and **2 were skipped**.

The tables list the rows visible in the screenshots. An ellipsis (`…`) marks a name or signature that Visual Studio cuts off. Some rows group parameterized cases, so the visible row counts can differ from the run totals.

## Passed (green)

| Test suite | Visible test name |
| --- | --- |
| `JsonExportAggregationSyntheticTests` | `Export_AggregatesInstancesAcrossLayo…` |
| `JsonExportSmokeTests` | `Export_FamilyMovedToPreNgl_IsFlagge…` |
| `JsonExportSmokeTests` | `Export_FamilyWithoutFaf_IsFlagged_Ass…` |
| `JsonExportSmokeTests` | `Export_NewerFafVersion_IsFlagged_Ass…` |

Test Explorer also shows green status icons for the collapsed suites `LayoutDescriptionIntegrationTests`, `PositionNumbersBatchIntegrationTests`, `PositionNumbersInputIntegrationTests`, and `SearchAddInIntegrationTests`. Their individual test names are hidden.

## Failed (red)

| Test suite | Visible test name |
| --- | --- |
| `JsonExportAggregationSyntheticTests` | `Export_PhaseDefinedDifferentlyInSubLa…` |
| `JsonExportSmokeTests` | `Export_AllGatesPass_AndJsonIsValid(Sys…` |
| `JsonExportSmokeTests` | `Export_EveryAsset_HasLocalBoundingB…` |
| `JsonExportSmokeTests` | `Export_IsReproducible(System.String)` (2 cases grouped) |
| `JsonExportSmokeTests` | `Export_MatchesGoldenFile(System.String)` |
| `JsonExportSmokeTests` | `Export_PurchasedPartWithModelNumb…` |
| `JsonExportSmokeTests` | `Export_PurchasedPartWithoutModelNu…` |

## Skipped (yellow)

The visible skipped row in `JsonExportSmokeTests` is `Export_ResolvedThroughVaultSession_E…`. The run summary counts two skipped tests.
