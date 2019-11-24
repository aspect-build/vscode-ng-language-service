/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import * as path from 'path';
import * as vscode from 'vscode';
import * as lsp from 'vscode-languageclient';

import {registerCommands} from './commands';
import {projectLoadingNotification} from './protocol';

export function activate(context: vscode.ExtensionContext) {
  // If the extension is launched in debug mode then the debug server options are used
  // Otherwise the run options are used
  const serverOptions: lsp.ServerOptions = {
    run: {
      module: context.asAbsolutePath(path.join('server')),
      transport: lsp.TransportKind.ipc,
      args: constructArgs(context, false /* debug */),
      options: {
        env: {
          // Force TypeScript to use the non-polling version of the file watchers.
          TSC_NONPOLLING_WATCHER: true,
        },
      },
    },
    debug: {
      module: context.asAbsolutePath(path.join('server', 'out', 'server.js')),
      transport: lsp.TransportKind.ipc,
      args: constructArgs(context, true /* debug */),
      options: {
        env: {
          // Force TypeScript to use the non-polling version of the file watchers.
          TSC_NONPOLLING_WATCHER: true,
          NG_DEBUG: true,
        },
        execArgv: [
          // do not lazily evaluate the code so all breakpoints are respected
          '--nolazy',
          // If debugging port is changed, update .vscode/launch.json as well
          '--inspect=6009',
        ]
      },
    },
  };

  // Options to control the language client
  const clientOptions: lsp.LanguageClientOptions = {
    // Register the server for Angular templates and TypeScript documents
    documentSelector: [
      // scheme: 'file' means listen to changes to files on disk only
      // other option is 'untitled', for buffer in the editor (like a new doc)
      {scheme: 'file', language: 'html'},
      {scheme: 'file', language: 'typescript'},
    ],

    synchronize: {
      fileEvents: [
        // Notify the server about file changes to tsconfig.json contained in the workspace
        vscode.workspace.createFileSystemWatcher('**/tsconfig.json'),
      ]
    },

    // Don't let our output console pop open
    revealOutputChannelOn: lsp.RevealOutputChannelOn.Never
  };

  // Create the language client and start the client.
  const forceDebug = !!process.env['NG_DEBUG'];
  const client =
      new lsp.LanguageClient('Angular Language Service', serverOptions, clientOptions, forceDebug);

  // Push the disposable to the context's subscriptions so that the
  // client can be deactivated on extension deactivation
  context.subscriptions.push(
      ...registerCommands(client),
      client.start(),
  );

  client.onReady().then(() => {
    const projectLoadingTasks = new Map<string, {resolve: () => void}>();

    client.onNotification(projectLoadingNotification.start, (projectName: string) => {
      vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Window,
            title: 'Initializing Angular language features',
          },
          () => new Promise((resolve) => {
            projectLoadingTasks.set(projectName, {resolve});
          }));
    });

    client.onNotification(projectLoadingNotification.finish, (projectName: string) => {
      const task = projectLoadingTasks.get(projectName);
      if (task) {
        task.resolve();
        projectLoadingTasks.delete(projectName);
      }
    });
  });
}

/**
 * Return the paths for the module that corresponds to the specified `configValue`,
 * and use the specified `bundled` as fallback if none is provided.
 * @param configName
 * @param bundled
 */
function getProbeLocations(configValue: string|null, bundled: string): string[] {
  const locations = [];
  // Always use config value if it's specified
  if (configValue) {
    locations.push(configValue);
  }
  // If not, look in workspaces currently open
  const workspaceFolders = vscode.workspace.workspaceFolders || [];
  for (const folder of workspaceFolders) {
    locations.push(folder.uri.fsPath);
  }
  // If all else fails, load the bundled version
  locations.push(bundled);
  return locations;
}

/**
 * Construct the arguments that's used to spawn the server process.
 * @param ctx vscode extension context
 * @param debug true if debug mode is on
 */
function constructArgs(ctx: vscode.ExtensionContext, debug: boolean): string[] {
  const config = vscode.workspace.getConfiguration();
  const args: string[] = [];

  const ngLog: string = config.get('angular.log', 'off');
  if (ngLog !== 'off') {
    // Log file does not yet exist on disk. It is up to the server to create the file.
    const logFile = path.join(ctx.logPath, 'nglangsvc.log');
    args.push('--logFile', logFile);
    args.push('--logVerbosity', debug ? 'verbose' : ngLog);
  }

  // Due to a bug in tsserver, ngProbeLocation is not honored when tsserver
  // loads the plugin. tsserver would look for @angular/language-service in its
  // peer node_modules directory, and use that if it finds one. To work around
  // this bug, always load typescript from the bundled location for now, so that
  // the bundled @angular/language-service is always chosen.
  // See the following links:
  // 1. https://github.com/angular/vscode-ng-language-service/issues/437
  // 2. https://github.com/microsoft/TypeScript/issues/34616
  // 3. https://github.com/microsoft/TypeScript/pull/34656
  // TODO: Remove workaround once
  // https://github.com/microsoft/TypeScript/commit/f689982c9f2081bc90d2192eee96b404f75c4705
  // is released and Angular is switched over to the new TypeScript version.
  args.push('--ngProbeLocations', ctx.asAbsolutePath('server'));
  args.push('--tsProbeLocations', ctx.extensionPath);

  /*
  const ngdk: string|null = config.get('angular.ngdk', null);
  const ngProbeLocations = getProbeLocations(ngdk, ctx.asAbsolutePath('server'));
  args.push('--ngProbeLocations', ngProbeLocations.join(','));

  const tsdk: string|null = config.get('typescript.tsdk', null);
  const tsProbeLocations = getProbeLocations(tsdk, ctx.extensionPath);
  args.push('--tsProbeLocations', tsProbeLocations.join(','));
  */

  return args;
}
