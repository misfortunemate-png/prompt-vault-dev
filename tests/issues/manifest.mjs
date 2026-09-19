import pv005 from './pv-005-save-overwrite.mjs';
import pv008 from './pv-008-updated-at-lww.mjs';
import pv009 from './pv-009-delete-order.mjs';
import pv016 from './pv-016-backend-identity.mjs';
import pv020 from './pv-020-save-partial-failure.mjs';
import pv023 from './pv-023-cors-preview.mjs';
import pv040 from './pv-040-scanner-read-failure.mjs';
import pv042 from './pv-042-template-backend-identity.mjs';
import pv043 from './pv-043-settings-backend-identity.mjs';
import pv044 from './pv-044-reachability-race.mjs';
import pv045 from './pv-045-template-cloud-thumb.mjs';
import pv047 from './pv-047-cross-tab-connection.mjs';
import pv049 from './pv-049-connection-revision.mjs';
import pv053 from './pv-053-cloud-fallback.mjs';
import pv056 from './pv-056-cloud-business-api.mjs';
import pv070 from './pv-070-album-backend-scope.mjs';

export const issueVerifiers = Object.freeze({
  [pv005.issue]: pv005,
  [pv008.issue]: pv008,
  [pv009.issue]: pv009,
  [pv016.issue]: pv016,
  [pv020.issue]: pv020,
  [pv023.issue]: pv023,
  [pv040.issue]: pv040,
  [pv042.issue]: pv042,
  [pv043.issue]: pv043,
  [pv044.issue]: pv044,
  [pv045.issue]: pv045,
  [pv047.issue]: pv047,
  [pv049.issue]: pv049,
  [pv053.issue]: pv053,
  [pv056.issue]: pv056,
  [pv070.issue]: pv070,
});
