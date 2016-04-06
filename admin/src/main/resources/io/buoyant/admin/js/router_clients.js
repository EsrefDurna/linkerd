var RouterClient = (function() {
  var template;
  const metricToColorShade = {
    "max": "dark",
    "p9990": "shade",
    "p99": "neutral",
    "p95": "tint",
    "p50": "light"
  }

  function createChartLegend(colorLookup) {
    return _.mapValues(metricToColorShade, function(shade) {
      return colorLookup[shade];
    });
  }

  function getMetricDefinitions(routerName, clientName) {
    return _.map(["requests", "connections", "success", "failures"], function(metric) {
      return {
        metricSuffix: metric,
        query: Query.clientQuery().withRouter(routerName).withClient(clientName).withMetric(metric).build()
      }
    });
  }

  function renderMetrics($container, client, summaryData, latencyData, chartLegend) {
    var clientHtml = template($.extend({
      client: client.label,
      latencies: latencyData,
      legend: chartLegend
    }, summaryData));
    var $clientHtml = $("<div />").addClass("router-client").html(clientHtml);

    $container.html($clientHtml);
  }

  function getLatencyData(client, latencyKeys) {
    var latencyData = _.pick(client.metrics, latencyKeys);
    var tableData = {};
    var chartData = [];

    _.each(latencyData, function(latencyValue, metricName) {
      tableData[metricName.split(".")[1]] = latencyValue;
      chartData.push({
        name: metricName,
        delta: latencyValue
      });
    });

    return { tableData: tableData, chartData: chartData };
  }

  function getSummaryData(data, metricDefinitions) {
    var summary = _.reduce(metricDefinitions, function(mem, defn) {
      var clientData = Query.filter(defn.query, data);
      mem[defn.metricSuffix] = _.isEmpty(clientData) ? null : clientData[0].delta;

      return mem;
    }, {});

    var successRate = new SuccessRate(summary.requests, summary.success, summary.failures);
    summary.successRate = successRate.prettyRate();

    return summary;
  }

  function initializeChart($chartEl, latencyKeys, timeseriesParamsFn) {
    var $canvas = $("<canvas id='canvas' height='141'></canvas>");
    $chartEl.append($canvas);

    var chart = new UpdateableChart(
      {
        minValue: 0,
        grid: {
          strokeStyle: '#878787',
          verticalSections: 1,
          millisPerLine: 10000,
          borderVisible: false
        },
        labels: {
          fillStyle: '#878787',
          fontSize: 12,
          precision: 0
        },
        millisPerPixel: 60
      },
      $canvas[0],
      function() {
        return $chartEl.width();
      },
      timeseriesParamsFn
    );
    var desiredLatencyMetrics = _.map(latencyKeys, function(metric) {
      return {
        name: metric,
        color: ""
      }
    });
    chart.setMetrics(desiredLatencyMetrics, true);

    return chart;
  }

  return function (metricsCollector, routers, client, $metricsEl, routerName, clientTemplate, $chartEl, colorShadesForClient) {
    template = clientTemplate;
    var chartLegend = createChartLegend(colorShadesForClient);
    var metricDefinitions = getMetricDefinitions(routerName, client.label);
    var latencyKeys = _.map(metricToColorShade, function(val, key) { return "request_latency_ms." + key });

    renderMetrics($metricsEl, client, [], [], chartLegend);
    var chart = initializeChart($chartEl, latencyKeys, timeseriesParams);

    function timeseriesParams(name) {
      return {
        strokeStyle: chartLegend[name.replace("request_latency_ms.", "")],
        lineWidth: 2
      };
    };

    var metricsHandler = function(data) {
      var filteredData = _.filter(data.specific, function (d) { return d.name.indexOf(routerName) !== -1 });
      var summaryData = getSummaryData(filteredData, metricDefinitions);
      var latencies = getLatencyData(client, latencyKeys);

      chart.updateMetrics(latencies.chartData);
      renderMetrics($metricsEl, client, summaryData, latencies.tableData, chartLegend);
    }

    var getDesiredMetrics = function(metrics) {
      return _.map(metricDefinitions, function(d) {
        return Query.filter(d.query, metrics);
      });
    }

    metricsCollector.registerListener(metricsHandler, getDesiredMetrics);

    return {
      updateColors: function(clientToColor) {
        chartLegend = createChartLegend(clientToColor[client.label].colorFamily);
      }
    };
  };
})();

var RouterClients = (function() {
  function assignColorsToClients(colors, clients) {
    var colorIdx = 0;

    return _.reduce(clients, function(clientMapping, client) {
      clientMapping[client.label] = colors[colorIdx++ % colors.length];
      return clientMapping;
    }, {});
  }

  return function (metricsCollector, routers, $clientEl, routerName, clientTemplate, clientContainerTemplate, colors) {
    var clientToColor = assignColorsToClients(colors, routers.clients(routerName));

    var routerClients = [];
    var combinedClientGraph = CombinedClientGraph(metricsCollector, routerName, $clientEl.find(".router-graph"), clientToColor);

    routers.onAddedClients(addClients);

    _.map(routers.clients(routerName), initializeClient);

    function initializeClient(client) {
      var colorsForClient = clientToColor[client.label].colorFamily;
      var $container = $(clientContainerTemplate({
        clientColor: colorsForClient.neutral
      })).appendTo($clientEl);
      var $metrics = $container.find(".metrics-container");
      var $chart = $container.find(".chart-container");

      routerClients.push(RouterClient(metricsCollector, routers, client, $metrics, routerName, clientTemplate, $chart, colorsForClient));
    }

    function addClients(addedClients) {
      // reassign colors
      clientToColor = assignColorsToClients(colors, routers.clients(routerName));

      // update existing client colors
      combinedClientGraph.updateColors(clientToColor);

      _.each(routerClients, function(routerClient) {
        routerClient.updateColors(clientToColor);
      });

      // add new clients
      _.chain(addedClients)
        .filter(function(client) { return client.router === routerName })
        .each(initializeClient)
        .value();
    }
  }
})();
