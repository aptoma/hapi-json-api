'use strict';

const Hapi = require('hapi');
const Boom = require('boom');
const assert = require('chai').assert;
const jsonapiPlugin = require('../');

describe('JSON API Plugin', () => {

	describe('onPreResponse', () => {

		it('should handle wrapped boom errors', (done) => {
			// fixes https://github.com/hapijs/hapi/issues/3587

			const domain = require('domain');
			const hapiDomain = domain.create();
			const server = new Hapi.Server();
			server.connection();

			hapiDomain.on('error', done);

			hapiDomain.run(() => {
				server.route({
					method: 'GET',
					path: '/test',
					handler(req, reply) {
						process.nextTick(() => {
							throw Boom.create(409, 'testo');
						});
					}
				});

				server
					.register({register: jsonapiPlugin})
					.then(() => server.inject({method: 'GET', url: '/test'}))
					.then((res) => {
						assert.equal(res.statusCode, 409);
						assert.deepEqual(res.result, {
							errors: [{status: '409', title: 'Conflict', details: 'testo'}]
						});
						done();
					})
					.catch(done);
			});

		});

	});

	describe('Decorated reply functions', () => {
		let server;

		function testReply(handler, response) {
			server.route({
				method: 'GET',
				path: '/test',
				handler: handler
			});

			server.inject({method: 'GET', url: '/test'}, response);
		}

		beforeEach((done) => {
			server = new Hapi.Server();
			server.connection();
			server.register({
				register: jsonapiPlugin
			}, done);
		});

		describe('#reply.jsonApi()', () => {

			it('should format single object and reply', (done) => {
				const model = new Model({id: 1, name: 'foo'});

				testReply((req, reply) => {
					reply.jsonApi('models', model);
				}, (res) => {
					assert.deepEqual(res.result, {
						data: {
							type: 'models',
							id: 1,
							attributes: {
								name: 'foo'
							},
							relationships: {
								foos: {data: []}
							}
						}
					});
					done();
				});
			});

			it('should format collection and reply', (done) => {
				const model = new Model({id: 1, name: 'foo'});

				testReply((req, reply) => {
					reply.jsonApi('models', [model]);
				}, (res) => {
					assert.deepEqual(res.result, {
						data: [{
							type: 'models',
							id: 1,
							attributes: {
								name: 'foo'
							},
							relationships: {
								foos: {data: []}
							}
						}]
					});
					done();
				});
			});

			it('should format and reply with options', (done) => {
				const model = new Model({id: 1, name: 'foo'});

				testReply((req, reply) => {
					reply.jsonApi('models', [model], {meta: {foo: 'bar'}});
				}, (res) => {
					assert.deepEqual(res.result, {
						data: [{
							type: 'models',
							id: 1,
							attributes: {
								name: 'foo'
							},
							relationships: {
								foos: {data: []}
							}
						}],
						meta: {
							foo: 'bar'
						}
					});
					done();
				});
			});
		});

		describe('#reply.jsonApiFunction()', () => {

			it('should format single object and reply', (done) => {
				const model = new Model({id: 1, name: 'foo'});

				testReply((req, reply) => {
					reply.jsonApiFunction('models')(model);
				}, (res) => {
					assert.deepEqual(res.result, {
						data: {
							type: 'models',
							id: 1,
							attributes: {
								name: 'foo'
							},
							relationships: {
								foos: {data: []}
							}
						}
					});
					done();
				});
			});

			it('should format collection and reply', (done) => {
				const model = new Model({id: 1, name: 'foo'});

				testReply((req, reply) => {
					reply.jsonApiFunction('models')([model]);
				}, (res) => {
					assert.deepEqual(res.result, {
						data: [{
							type: 'models',
							id: 1,
							attributes: {
								name: 'foo'
							},
							relationships: {
								foos: {data: []}
							}
						}]
					});
					done();
				});
			});

			it('should format and reply with options', (done) => {
				const model = new Model({id: 1, name: 'foo'});

				testReply((req, reply) => {
					reply.jsonApiFunction('models', {meta: {foo: 'bar'}})(model);
				}, (res) => {
					assert.deepEqual(res.result, {
						data: {
							type: 'models',
							id: 1,
							attributes: {
								name: 'foo'
							},
							relationships: {
								foos: {data: []}
							}
						},
						meta: {
							foo: 'bar'
						}
					});
					done();
				});
			});

			it('should format and reply with custom statuscode', (done) => {
				const model = new Model({id: 1, name: 'foo'});

				testReply((req, reply) => {
					reply.jsonApiFunction('models', {}, 201)(model);
				}, (res) => {
					assert.equal(res.statusCode, 201);
					assert.deepEqual(res.result, {
						data: {
							type: 'models',
							id: 1,
							attributes: {
								name: 'foo'
							},
							relationships: {
								foos: {data: []}
							}
						}
					});
					done();
				});
			});
		});
	});

	describe('toAPI()', () => {

		it('should format data according to jsonapi.org spec', () => {
			const model = new Model({id: 1, name: 'foo'});
			const result = jsonapiPlugin.toAPI('models', model);
			assert.deepEqual(result, {
				type: 'models',
				id: 1,
				attributes: {
					name: 'foo'
				},
				relationships: {
					foos: {data: []}
				}
			});
		});

		it('should support named relationships', () => {
			const model = new Model({id: 1, name: 'foo'}, namedRelationships);
			const result = jsonapiPlugin.toAPI('models', model);
			assert.deepEqual(result, {
				type: 'models',
				id: 1,
				attributes: {
					name: 'foo'
				},
				relationships: {
					myFoos: {data: []}
				}
			});
		});

		it('should support raw json data', () => {
			const result = jsonapiPlugin.toAPI('models', {name: 'foo', id: 'foo'});
			assert.deepEqual(result, {
				type: 'models',
				id: 'foo',
				attributes: {
					name: 'foo'
				}
			});
		});
	});

	describe('formatObject()', () => {

		it('should append meta at top level', () => {
			const model = new Model({name: 'foo'});
			const meta = {foo: 'bar'};
			const result = jsonapiPlugin.formatObject('models', model, {
				meta: meta
			});
			assert.deepEqual(result.meta, meta);
		});

		it('should format data according to jsonapi.org spec and wrap in `data` field', () => {
			const foos = [{id: '1', name: 'foo1'}, {id: '2', name: 'foo2'}];
			const model = new Model({id: 1, name: 'foo', foos: foos});
			const result = jsonapiPlugin.formatObject('models', model);
			assert.deepEqual(result, {
				data: {
					type: 'models',
					id: 1,
					attributes: {
						name: 'foo'
					},
					relationships: {
						foos: {
							data: [
								{type: 'foos', id: '1'},
								{type: 'foos', id: '2'}
							]
						}
					}
				}
			});
		});
	});

	describe('formatCollection()', () => {

		it('should format data according to jsonapi.org spec and wrap in `data` field', () => {
			const model = new Model({id: 1, name: 'foo'});
			const result = jsonapiPlugin.formatCollection('models', [model]);
			assert.deepEqual(result, {
				data: [{
					type: 'models',
					id: 1,
					attributes: {
						name: 'foo'
					},
					relationships: {
						foos: {data: []}
					}
				}]
			});
		});

		it('should append meta at top level', () => {
			const model = new Model({name: 'foo'});
			const meta = {foo: 'bar'};
			const result = jsonapiPlugin.formatCollection('models', [model], {
				meta: meta
			});
			assert.deepEqual(result.meta, meta);
		});

		it('should place included resources on the top level', () => {
			const model = new Model({
				id: 1,
				name: 'foo',
				foos: [{id: 123, name: 'foo-1'}]
			});

			const result = jsonapiPlugin.formatCollection('models', [model], {
				includedRelationships: ['foos']
			});

			assert.deepEqual(result, {
				data: [{
					type: 'models',
					id: 1,
					attributes: {
						name: 'foo'
					},
					relationships: {
						foos: {data: [
							{type: 'foos', id: 123}
						]}
					}
				}],
				included: [
					{type: 'foos', id: 123, attributes: {
						name: 'foo-1'
					}}
				]
			});
		});

		it('should only include each included resource once', () => {
			const model1 = new Model({
				id: 1,
				name: 'foo',
				foos: [{id: 123, name: 'foo-1'}]
			});

			const model2 = new Model({
				id: 2,
				name: 'bar',
				foos: [
					{id: 123, name: 'foo-1'},
					{id: 456, name: 'foo-2'}
				]
			});

			const result = jsonapiPlugin.formatCollection('models', [model1, model2], {
				includedRelationships: ['foos']
			});

			assert.lengthOf(result.included, 2);
			assert.deepEqual(result.included, [
				{type: 'foos', id: 123, attributes: {name: 'foo-1'}},
				{type: 'foos', id: 456, attributes: {name: 'foo-2'}}
			]);
		});

	});

});

function namedRelationships() {
	return [{type: 'foos', items: this.data.foos || [], name: 'myFoos'}];
}

class Model {
	constructor(data, relationships) {
		this.data = data;
		this.relationships = relationships || function () {
			return [{type: 'foos', items: this.data.foos || []}];
		};
	}

	get id() {
		return this.data.id || Math.ceil(Math.random() * 1000);
	}

	getRelationships() {
		return this.relationships();
	}

	toJSON() {
		return this.data;
	}
}
