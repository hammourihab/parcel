// @flow
import semver from 'semver';
import generate from '@babel/generator';
import {Transformer} from '@parcel/plugin';
import collectDependencies from './visitors/dependencies';
import envVisitor from './visitors/env';
import fsVisitor from './visitors/fs';
import insertGlobals from './visitors/globals';
import {parse} from '@babel/parser';
import traverse from '@babel/traverse';
import * as walk from 'babylon-walk';

const IMPORT_RE = /\b(?:import\b|export\b|require\s*\()/;
const ENV_RE = /\b(?:process\.env)\b/;
const GLOBAL_RE = /\b(?:process|__dirname|__filename|global|Buffer|define)\b/;
const FS_RE = /\breadFileSync\b/;
const SW_RE = /\bnavigator\s*\.\s*serviceWorker\s*\.\s*register\s*\(/;
const WORKER_RE = /\bnew\s*(?:Shared)?Worker\s*\(/;

// Sourcemap extraction
// const SOURCEMAP_RE = /\/\/\s*[@#]\s*sourceMappingURL\s*=\s*([^\s]+)/;
// const DATA_URL_RE = /^data:[^;]+(?:;charset=[^;]+)?;base64,(.*)/;

function canHaveDependencies(code) {
  return (
    IMPORT_RE.test(code) ||
    GLOBAL_RE.test(code) ||
    SW_RE.test(code) ||
    WORKER_RE.test(code)
  );
}

export default new Transformer({
  canReuseAST(ast) {
    return ast.type === 'babel' && semver.satisfies(ast.version, '^7.0.0');
  },

  async parse(asset /*, config , options */) {
    if (
      !canHaveDependencies(asset.code) &&
      !ENV_RE.test(asset.code) &&
      !FS_RE.test(asset.code)
    ) {
      return null;
    }

    return {
      type: 'babel',
      version: '7.0.0',
      isDirty: false,
      program: parse(asset.code, {
        filename: this.name,
        allowReturnOutsideFunction: true,
        strictMode: false,
        sourceType: 'module',
        plugins: ['exportDefaultFrom', 'exportNamespaceFrom', 'dynamicImport']
      })
    };
  },

  async transform(asset, config, options) {
    if (!asset.ast) {
      return [asset];
    }

    // Inline environment variables
    if (asset.env.context === 'browser' && ENV_RE.test(asset.code)) {
      walk.simple(asset.ast.program, envVisitor, asset);
    }

    // Collect dependencies
    if (canHaveDependencies(asset.code)) {
      walk.ancestor(asset.ast.program, collectDependencies, asset);
    }

    if (asset.env.context === 'browser') {
      // Inline fs calls
      let fsDep = asset.dependencies.find(dep => dep.moduleSpecifier === 'fs');
      if (fsDep && FS_RE.test(asset.code)) {
        // Check if we should ignore fs calls
        // See https://github.com/defunctzombie/node-browser-resolve#skip
        // let pkg = await this.getPackage();
        // let ignore = pkg && pkg.browser && pkg.browser.fs === false;
        let ignore;

        if (!ignore) {
          traverse(asset.ast.program, fsVisitor, null, asset);
        }
      }

      // Insert node globals
      // if (GLOBAL_RE.test(asset.code)) {
      //   walk.ancestor(asset.ast.program, insertGlobals, asset);
      // }
    }

    // Do some transforms
    return [asset];
  },

  async generate(module, config, options) {
    if (module.ast.isDirty === false) {
      return {
        code: module.code
        // TODO: sourcemaps
      };
    }

    let generated = generate(
      module.ast.program,
      {
        sourceMaps: options.sourceMaps,
        sourceFileName: module.relativeName
      },
      module.code
    );

    return {
      code: generated.code,
      map: generated.map
    };
  }
});
