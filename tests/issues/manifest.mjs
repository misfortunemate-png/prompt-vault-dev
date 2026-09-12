import pv016 from './pv-016-backend-identity.mjs';
import pv020 from './pv-020-save-partial-failure.mjs';
import pv023 from './pv-023-cors-preview.mjs';
import pv042 from './pv-042-template-backend-identity.mjs';
import pv043 from './pv-043-settings-backend-identity.mjs';
import pv044 from './pv-044-reachability-race.mjs';
import pv045 from './pv-045-template-cloud-thumb.mjs';
import pv047 from './pv-047-cross-tab-connection.mjs';

export const issueVerifiers = Object.freeze({
  [pv016.issue]: pv016,
  [pv020.issue]: pv020,
  [pv023.issue]: pv023,
  [pv042.issue]: pv042,
  [pv043.issue]: pv043,
  [pv044.issue]: pv044,
  [pv045.issue]: pv045,
  [pv047.issue]: pv047,
});
