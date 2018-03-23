'use strict';

const R = require('ramda');

/**
 * @typedef {object} JSONAPIFormatOptions
 * @property {Account} [account]
 * @property {string[]} [includedRelationships]
 * @property {object} [meta]
 */

/**
 * @typedef {object} JSONAPIItem
 * @property {string} type
 * @property {string} id
 * @property {object} attributes
 * @property {object[]} [included]
 */

exports.formatObject = formatObject;
exports.formatCollection = formatCollection;
exports.toAPI = toAPI;

exports.plugin = {
	name: 'service-jsonapi',
	register(server) {
		server.expose('formatObject', exports.formatObject);
		server.expose('formatObjectWithOptions', exports.formatObjectWithOptions);
		server.expose('formatCollection', exports.formatCollection);
		server.expose('formatCollectionWithOptions', exports.formatCollectionWithOptions);
		server.expose('toAPI', exports.toAPI);

		server.ext('onPreResponse', formatError);

		server.decorate('toolkit', 'jsonApi', replyJsonApi);
		server.decorate('toolkit', 'jsonApiFunction', replyJsonApiFunction);
	}
};

const internals = {
	deleteAndReturnProperty: R.curry(deleteAndReturnProperty)
};

/**
 * Format object(s) according to JSONAPI and add the result to the response
 *
 * @param  {String} type
 * @param  {Object|Array} objects items to format
 * @param {JSONAPIFormatOptions} [options]
 * @this Hapi.Reply
 * @return {Hapi.ResponseObject}
 */
function replyJsonApi(type, objects, options) {
	return replyFunction.bind(this)(type, objects, options);
}

/**
 * Format object(s) according to JSONAPI and add the result to the response
 *
 * @param  {String} type
 * @param {JSONAPIFormatOptions} [options]
 * @param  {Integer} [code] sets statusCode
 * @this Hapi.Reply
 * @return {Function} returns curried replyFunction that accepts objects to format as a parameter.
 */
function replyJsonApiFunction(type, options, code) {
	return R.curry(R.bind(replyFunction, this))(type, R.__, options, code);
}

/**
 * Format object(s) according to JSONAPI and add the result to the response
 *
 * @param  {String} type
 * @param  {Object|Array} objects items to format
 * @param {JSONAPIFormatOptions} [options]
 * @param  {Integer} [code] sets statusCode
 * @this Hapi.Reply
 * @return {Hapi.ResponseObject}
 */
function replyFunction(type, objects, options, code) {
	let resp;
	options = options || {};
	if (objects instanceof Array) {
		resp = this.response(formatCollection(type, objects, options));
	} else {
		resp = this.response(formatObject(type, objects, options));
	}

	if (code) {
		resp.code(code);
	}

	return resp;
}

/**
 * onPreResponse handler for formatting error objects according to JSONAPI spec.
 * @param  {Hapi.Request} req
 * @param  {Hapi.Toolkit} h
 * @return {Hapi.ResponseObject}
 */
function formatError(req, h) {
	const response = req.response;

	if (!response.isBoom) {
		return h.continue;
	}

	const errorObject = {
		status: String(response.output.statusCode),
		title: response.output.payload.error,
		details: response.output.payload.message
	};

	if (response.data) {
		// only output data to consumers in _expose
		if (response.data._expose) {
			errorObject.meta = response.data._expose;
		}

		// log all data for errors
		if (response.output.statusCode === 500) {
			req.log('error', response.data instanceof Buffer ? response.data.toString() : response.data);
		}
	}

	if (response.isJoi && response.details && typeof response.details.map === 'function') {
		const message = response.details.map(getJoiErrorMessage).join(', ');
		errorObject.details = message;
	}

	return h.response({
		errors: [errorObject]
	}).code(response.output.statusCode);
}

function getJoiErrorMessage(details) {
	return `Validation error: ${details.message} (${details.path.join('.')})`;
}

/**
 * Format a collection according to JSON API spec
 *
 * @param {string} type
 * @param {Array} items
 * @param {JSONAPIFormatOptions} [options]
 * @return {Object}
 */
function formatCollection(type, items, options) {
	options = options || {};
	const data = items.map((i) => toAPI(type, i, options));

	if (!options.includedRelationships) {
		return appendMeta(options.meta, {data: data});
	}

	const pullIncluded = R.compose(
		R.uniqBy(R.prop('id')),
		R.flatten,
		R.map(internals.deleteAndReturnProperty('included'))
	);

	return appendMeta(options.meta, {
		data: data,
		included: pullIncluded(data)
	});
}

function deleteAndReturnProperty(propertyName, obj) {
	const property = obj[propertyName];
	delete obj[propertyName];
	return property;
}

/**
 * Append meta to payload
 * @param  {Object} [meta]
 * @param  {Object} payload
 * @return {Object}
 */
function appendMeta(meta, payload) {
	if (!meta) {
		return payload;
	}
	payload.meta = meta;
	return payload;
}

/**
 * Format an object according to JSON API spec
 *
 * @param {string} type
 * @param {mongoose.Model|Object} object
 * @param {JSONAPIFormatOptions} [options]
 * @return {Object}
 */
function formatObject(type, object, options) {
	options = options || {};

	return appendMeta(options.meta, {
		data: toAPI(type, object, options)
	});
}

/**
 * Format an object according to JSON API spec
 *
 * @param {String} type
 * @param {Object} data
 * @param {JSONAPIFormatOptions} options
 * @return {JSONAPIItem}
 */
function toAPI(type, data, options) {
	options = options || {};
	const ret = {
		type: type,
		id: data.id || data._id,
		attributes: data.toJSON ? data.toJSON() : data
	};

	delete ret.attributes.id;
	delete ret.attributes._id;

	if (options.includedRelationships && options.includedRelationships.length) {
		ret.included = [];
	}

	let getRelationships;
	if (typeof (options.getRelationships) === 'function') {
		getRelationships = options.getRelationships;
	} else if (typeof (data.getRelationships) === 'function') {
		getRelationships = data.getRelationships.bind(data);
	}

	if (getRelationships) {
		ret.relationships = {};
		getRelationships(options, data).forEach((relationship) => {
			if (!relationship.keep) {
				delete ret.attributes[relationship.type];
				if (relationship.name) {
					delete ret.attributes[relationship.name];
				}
			}

			let relationshipData;

			if (relationship.item) {
				relationshipData = {
					type: relationship.type,
					id: getId(relationship.item)
				};

				if (ret.included && R.contains(relationship.type, options.includedRelationships)) {
					ret.included.push(toAPI(relationship.type, relationship.item));
				}
			} else if (relationship.items) {
				relationshipData = relationship.items.map((item) => {
					const data = {
						type: relationship.type,
						id: getId(item)
					};
					if (ret.included && R.contains(relationship.type, options.includedRelationships)) {
						ret.included.push(toAPI(relationship.type, item));
					}

					return data;
				});
			}

			ret.relationships[relationship.name || relationship.type] = {data: relationshipData};
		});
	}

	return ret;
}

/**
 * Get ID as string from mixed mongoose/mongodb objects
 *
 * @param  {Object|String} item
 * @return {String}
 */
function getId(item) {
	if (item._bsontype) {
		// its important that check for ._bsontype is above the check for .id since both will evaluate true
		// on a ObjectId
		return item.toString();
	}

	if (item.id) {
		return item.id;
	}

	if (typeof (item) === 'string') {
		return item;
	}
}
