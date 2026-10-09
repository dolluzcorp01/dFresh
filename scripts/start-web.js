// CRA reads PORT from .env, where PORT is the API port (4012). CRA never overrides a variable that is
// already set, so pinning the web port here keeps the two servers apart without an extra package.
process.env.PORT = process.env.WEB_PORT || '3000';
require('react-scripts/scripts/start');
