// Small synthetic path graph shared by placement.test.js and
// rotation_job.test.js. Deliberately NOT read from campus_paths.json —
// that file now holds real OpenStreetMap-derived data (see
// scripts/fetch_osm_paths.js) and its exact shape/zone ids can change
// whenever it's regenerated. Tests should never depend on that; they get
// this fixed, hand-built grid instead, injected via the `graph` param.
export const FIXTURE_GRAPH = {
	nodes: [
		{ id: 'n1', lat: -26.195, lng: 28.019 },
		{ id: 'n2', lat: -26.195, lng: 28.029 },
		{ id: 'n3', lat: -26.195, lng: 28.038 },
		{ id: 'n4', lat: -26.195, lng: 28.047 },
		{ id: 'n5', lat: -26.189, lng: 28.019 },
		{ id: 'n6', lat: -26.189, lng: 28.023 },
		{ id: 'n7', lat: -26.189, lng: 28.032 },
		{ id: 'n8', lat: -26.189, lng: 28.041 },
		{ id: 'n9', lat: -26.189, lng: 28.047 },
		{ id: 'n10', lat: -26.183, lng: 28.021 },
		{ id: 'n11', lat: -26.183, lng: 28.029 },
		{ id: 'n12', lat: -26.183, lng: 28.038 },
		{ id: 'n13', lat: -26.183, lng: 28.045 },
		{ id: 'n14', lat: -26.177, lng: 28.023 },
		{ id: 'n15', lat: -26.177, lng: 28.032 },
		{ id: 'n16', lat: -26.177, lng: 28.041 },
		{ id: 'n17', lat: -26.175, lng: 28.025 },
		{ id: 'n18', lat: -26.175, lng: 28.036 },
	],
	edges: [
		['n1', 'n2'],
		['n2', 'n3'],
		['n3', 'n4'],
		['n5', 'n6'],
		['n6', 'n7'],
		['n7', 'n8'],
		['n8', 'n9'],
		['n10', 'n11'],
		['n11', 'n12'],
		['n12', 'n13'],
		['n14', 'n15'],
		['n15', 'n16'],
		['n17', 'n18'],
		['n1', 'n5'],
		['n2', 'n7'],
		['n3', 'n8'],
		['n4', 'n9'],
		['n5', 'n10'],
		['n7', 'n11'],
		['n8', 'n12'],
		['n9', 'n13'],
		['n10', 'n14'],
		['n11', 'n15'],
		['n12', 'n16'],
		['n14', 'n17'],
		['n15', 'n18'],
		['n16', 'n18'],
	],
	zones: [
		{
			id: 'west_campus',
			name: 'West Campus',
			bounds: {
				west: 28.017,
				east: 28.026,
				south: -26.198,
				north: -26.173,
			},
		},
		{
			id: 'great_hall',
			name: 'Great Hall',
			bounds: {
				west: 28.026,
				east: 28.034,
				south: -26.18,
				north: -26.173,
			},
		},
		{
			id: 'library_lawns',
			name: 'Library Lawns',
			bounds: {
				west: 28.026,
				east: 28.034,
				south: -26.198,
				north: -26.18,
			},
		},
		{
			id: 'east_campus',
			name: 'East Campus',
			bounds: {
				west: 28.034,
				east: 28.043,
				south: -26.198,
				north: -26.173,
			},
		},
		{
			id: 'science_stadium',
			name: 'Science Stadium',
			bounds: {
				west: 28.043,
				east: 28.05,
				south: -26.198,
				north: -26.173,
			},
		},
	],
}
