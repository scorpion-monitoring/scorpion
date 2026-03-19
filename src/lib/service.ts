import { writable, get, derived } from 'svelte/store';
import { keyed } from '@humanspeak/svelte-keyed';

function createServiceStoresSynced() {
	const storeServiceObj = writable({});
	const storeServiceStr = writable('');

	const setServiceObj = (ServiceObj: any) => {
		storeServiceObj.set(ServiceObj);
		storeServiceStr.set(JSON.stringify(ServiceObj, null, 2));
	};

	const updateServiceObj = (ServiceObj: any) => {
		storeServiceObj.update(ServiceObj);
		storeServiceStr.set(JSON.stringify(get(storeServiceObj), null, 2));
	};

	const setServiceStr = (ServiceStr: string) => {
		storeServiceObj.set(JSON.parse(ServiceStr));
		storeServiceStr.set(ServiceStr);
	};

	type ServiceObjStore = {
		subscribe: typeof storeServiceObj.subscribe;
		update: typeof updateServiceObj;
		set: typeof setServiceObj;
		keyed?: (level: any) => ReturnType<typeof keyed>;
		keyedComments?: (jsonPath: any, commentName: any) => any;
	};

	const storesSynced: {
		ServiceObj: ServiceObjStore;
		ServiceStr: {
			subscribe: typeof storeServiceStr.subscribe;
			set: typeof setServiceStr;
		};
	} = {
		ServiceObj: {
			subscribe: storeServiceObj.subscribe,
			update: updateServiceObj,
			set: setServiceObj
		},
		ServiceStr: {
			subscribe: storeServiceStr.subscribe,
			set: setServiceStr
		}
	};

	storesSynced.ServiceObj.keyed = (level) => keyed(storesSynced.ServiceObj, level);

	storesSynced.ServiceObj.keyedComments = (jsonPath, commentName) => {
		const keyedComments = keyed(storesSynced.ServiceObj, jsonPath);

		const derivedComments = derived(keyedComments, ($comments) => {
			let comment = $comments.find((c: { name: string; value: string }) => c.name == commentName);
			let value = '';
			if (comment) {
				value = comment.value;
			}
			return value;
		});

		const update = (value: string) => {
			if (!value) {
				value = '';
			}
			keyedComments.update(($comments) => {
				let comment = $comments.find((c: { name: string; value: string }) => c.name == commentName);
				if (comment) {
					comment.value = value;
					$comments = $comments;
				} else {
					comment = { name: commentName, value: value };
					$comments = [...$comments, comment];
				}
				return $comments;
			});
		};
		const set = (value: string) => {
			update(value);
		};

		const store = {
			subscribe: derivedComments.subscribe,
			update: update,
			set: set
		};

		return store;
	};

	return storesSynced;
}

const storesService = createServiceStoresSynced();

export const serviceObj = storesService.ServiceObj;
export const serviceStr = storesService.ServiceStr;
