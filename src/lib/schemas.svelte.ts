import service_schema from '$lib/schemas/service_schema.json';
import organization_schema from '$lib/schemas/organization_schema.json';
import maturity_model_schema from '$lib/schemas/maturity_model.json';
import settings_schema from '$lib/schemas/settings.json';
import securitySettings_schema from '$lib/schemas/security_settings.json';
import generalSettings_schema from '$lib/schemas/general_settings.json';
import oidc_provider_schema from '$lib/schemas/oidc_provider.json';
import backup_schema from '$lib/schemas/backup.json';

const mapping = {
	maturity_model: maturity_model_schema,
	service: service_schema,
	organization: organization_schema,
	settings: settings_schema,
	security: securitySettings_schema,
	general: generalSettings_schema,
	oidc_provider: oidc_provider_schema,
	backup: backup_schema
};

export default class Schemas {
	static getObjectFromSchema(identifier: string) {
		let schema = mapping[identifier as keyof typeof mapping];
		if (!schema) {
			throw new Error(`No schema found for identifier: ${identifier}`);
		}

		const getDataTypeByJsonType = (type: string) => {
			let types = {
				string: '',
				array: [],
				object: {},
				boolean: false
			};
			return types[type as keyof typeof types];
		};

		let obj: { [key: string]: any } = {};
		let keys = [];

		if (
			schema &&
			typeof schema === 'object' &&
			'properties' in schema &&
			typeof schema.properties === 'object'
		) {
			for (const [k, v] of Object.entries(schema.properties)) {
				keys.push(k);

				if (v['type'] === 'string') {
					obj[k] = '';
				} else if (v['type'] === 'number') {
					obj[k] = 0;
				} else if (v['type'] === 'boolean') {
					obj[k] = false;
				} else if (v['type'] === 'array') {
					obj[k] = [];
				} else if (v['type'] === 'object') {
					let entries = Object.entries(v['properties' as keyof typeof v] || {});
					if (entries.length === 0) {
						obj[k] = {};
					} else {
						obj[k] = Object.fromEntries(
							entries.map((x) => [x[0], getDataTypeByJsonType((x[1] as { type: string })['type'])])
						);
					}
				} else if (v['anyOf' as keyof typeof v] !== undefined) {
					if (v['anyOf' as keyof typeof v][0]['type'] !== undefined) {
						if (v['anyOf' as keyof typeof v][0]['type'] === 'string') {
							obj[k] = '';
						} else if (v['anyOf' as keyof typeof v][0]['type'] === 'boolean') {
							obj[k] = false;
						} else if (v['anyOf' as keyof typeof v][0]['type'] === 'array') {
							obj[k] = [];
						} else if (v['anyOf' as keyof typeof v][0]['type'] === 'object') {
							let entries = Object.entries(v['properties' as keyof typeof v] || {});
							if (entries.length === 0) {
								obj[k] = {};
							} else {
								obj[k] = Object.fromEntries(
									entries.map((x) => [
										x[0],
										getDataTypeByJsonType((x[1] as { type: string })['type'])
									])
								);
							}
						}
					} else if (v['anyOf' as keyof typeof v][0]['$ref'] !== undefined) {
						obj[k] = {};
					} else {
						obj[k] = null;
					}
				} else {
					obj[k] = {};
				}
			}
		}
		return obj;
	}
}
