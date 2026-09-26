// Survey a repo live and print the plat.
//   GITHUB_TOKEN=$(gh auth token) node examples/survey-repo.js sharkdp/hyperfine
import { survey, renderPlat } from '../src/index.js';

const report = await survey(process.argv[2] || 'sharkdp/hyperfine', { token: process.env.GITHUB_TOKEN });
console.log(renderPlat(report));
