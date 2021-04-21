const fs = require('fs');
const grpc = require('@grpc/grpc-js');
const { EventEmitter } = require('events');
// eslint-disable-next-line import/no-extraneous-dependencies
const ApolloServerExpress = require('apollo-server-express');
const RPCService = require('./rpc-service.js');
const { genResolvers, readDir } = require('./tools.js');

const { ApolloServer, makeExecutableSchema, gql } = ApolloServerExpress;
class RPCServer extends EventEmitter {
  /**
   * Creates an instance of RPC Server
   * @param {ServerConstructorParams} param0
   */
  constructor({
    protoFile, ip = '0.0.0.0', port = 50051, creds, graphql, packages, logger, addService,
  }) {
    super();

    this.gqlServer = undefined;
    this.rpcService = new RPCService({
      protoFile,
      grpcServer: new grpc.Server(),
      packages,
      graphql,
      addService,
    });

    this.rpcService.grpcServer.bindAsync(`${ip}:${port}`, creds || grpc.ServerCredentials.createInsecure(), (err, grpcPort) => {
      if (err) throw err;
      this.rpcService.grpcServer.start();
      this.port = grpcPort;
      this.emit('grpc_server_started', { ip, port: grpcPort });
    });

    // GraphQL server is not running by default. Set `graphql` to enabled.
    if ((graphql === undefined) || ((typeof graphql === 'boolean') && graphql !== true) || (typeof graphql === 'object' && graphql.enable !== true)) {
      return this;
    }

    const {
      schemaPath, resolverPath, context, formatError, playground, introspection, apolloConfig,
    } = graphql;

    const rootTypeDefs = `
      type Query{
        _: String
      }
      type Mutation {
        _: String
      }
    `;

    const auto = (graphql.auto !== undefined) ? graphql.auto : true;
    const registerTypes = [rootTypeDefs];
    const registerResolvers = [];

    if (schemaPath && resolverPath) {
      /* eslint-disable import/no-dynamic-require */
      /* eslint-disable global-require */
      /* eslint-disable-next-line import/no-dynamic-require */
      /** @type {string[]} */
      let schemasGraphql;
      /** @type {string[]} */
      let schemasJs;
      /** @type {string[]} */
      let controllers;
      if (Array.isArray(schemaPath)) {
        schemasJs = [];
        schemasGraphql = [];
        schemaPath.forEach((schema) => {
          schemasJs = schemasJs.concat(readDir(schema, '.js'));
          schemasGraphql = schemasGraphql.concat(readDir(schema, '.graphql'));
        });
      } else {
        schemasJs = readDir(schemaPath, '.js');
        schemasGraphql = readDir(schemaPath, '.graphql');
      }

      if (Array.isArray(resolverPath)) {
        controllers = [];
        resolverPath.forEach((resolver) => {
          controllers = controllers.concat(readDir(resolver, '.js'));
        });
      } else {
        controllers = readDir(resolverPath, '.js');
      }

      schemasJs.map((x) => registerTypes.push(require(x)));
      schemasGraphql.map((x) => registerTypes.push(fs.readFileSync(x, { encoding: 'utf8' })));
      controllers.map((x) => registerResolvers.push(require(x)));
    }

    if (auto) {
      // Construct a schema, using GraphQL schema language from
      // protobuf to GraphQL converter
      const { gqlSchema } = this.rpcService;
      if (!gqlSchema) {
        console.warn('GraphQL Server start failed due to missing schema.');
        return this;
      }
      // Provide resolver functions for your schema fields
      // This section will automatically generate functions and resolvers
      registerTypes.push(gql`${gqlSchema}`);
      registerResolvers.push(genResolvers(this.rpcService.packages));
    }

    this.gqlConfigs = {
      logger, context, formatError, playground, introspection,
    };

    this.gqlConfigs.schema = makeExecutableSchema({
      typeDefs: registerTypes,
      resolvers: registerResolvers,
      logger,
    });

    this.gqlConfigs = Object.assign(this.gqlConfigs, apolloConfig);
    this.gqlServer = new ApolloServer(this.gqlConfigs);
  }
}

module.exports = RPCServer;

/**
 * @typedef  {object} ServerConstructorParams
 * @property {string}                        ip
 * @property {number}                        port
 * @property {RPCService.RPCServicePackages} packages
 * @property {*}                             logger         Logger for GraphQL server
 * @property {RPCService.ParamAddService}    [addService]
 * @property {GraphqlProperty|boolean}       [graphql]
 * @property {grpc.ServerCredentials}        [creds]
 * @property {string|string[]}               [protoFile]
 */

/**
 * @typedef   {object} GraphqlProperty
 * @property  {boolean}            [enable=false]    Set to true to enable GraphQL
 * @property  {string|string[]}    [schemaPath]      Path of yours GraphQL schemas
 *                                                   (required if you want to create yours GraphQL)
 * @property  {string|string[]}    [resolverPath]    Path of yours GraphQL resolvers
 *                                                   (required if you want to create yours GraphQL)
 * @property  {function}  [context]
 * @property  {function}  [formatError]
 * @property  {object}    [introspection]
 * @property  {boolean|Playground} [playground] Reference:
 *                                              https://www.apollographql.com/docs/apollo-server/testing/graphql-playground/#configuring-playground
 * @property  {ApolloServerExpress.ApolloServerExpressConfig} [apolloConfig]
 */

/**
 * @typedef  {object} Playground
 * @property  {object}   [settings]
 * @property  {object[]} [tabs]
 */
