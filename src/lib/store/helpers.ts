// =================================================================
// store/helpers — composed initialState (LOOM-552)
// =================================================================

import { coreInitialState, datasetScopedResetSlice } from "./coreSlice";
import { tableInitialState } from "./tableSlice";
import { queryInitialState } from "./querySlice";
import { dashboardInitialState } from "./dashboardSlice";
import { uiInitialState } from "./uiSlice";
import { chartInitialState } from "./chartSlice";
import { pointerViewsInitialState } from "./pointerViewsSlice";
import { monitorInitialState } from "./monitorSlice";

export { datasetScopedResetSlice };

export const initialState = {
  ...coreInitialState(),
  ...tableInitialState(),
  ...queryInitialState(),
  ...dashboardInitialState(),
  ...uiInitialState(),
  ...chartInitialState(),
  ...pointerViewsInitialState(),
  ...monitorInitialState,
};
