function compileConstructor(dtype, dimension) {
      // PATCHED (PNGCut): the original ndarray implementation JIT-generated
      // view classes via dynamic string evaluation, which throws EvalError
      // under a strict Content-Security-Policy that does not allow 'unsafe-eval'.
      // This replacement builds equivalent view constructors with plain
      // closures — no string evaluation — with identical semantics.
      var useGetters = dtype === "generic";
      if (dimension === -1) {
        function ViewNil(a) {
          this.data = a;
        }
        var p = ViewNil.prototype;
        p.dtype = dtype;
        p.dimension = -1;
        p.index = function () {
          return -1;
        };
        p.size = 0;
        p.shape = p.stride = p.order = [];
        p.lo = p.hi = p.transpose = p.step = function () {
          return new ViewNil(this.data);
        };
        p.get = p.set = function () {};
        p.pick = function () {
          return null;
        };
        return function construct_ViewNil(a) {
          return new ViewNil(a);
        };
      }
      if (dimension === 0) {
        function View0(a, d) {
          this.data = a;
          this.offset = d;
        }
        var p = View0.prototype;
        p.dtype = dtype;
        p.dimension = 0;
        p.index = function () {
          return this.offset;
        };
        p.size = 1;
        p.shape = p.stride = p.order = [];
        p.lo = p.hi = p.transpose = p.step = function () {
          return new View0(this.data, this.offset);
        };
        p.pick = function () {
          return CACHED_CONSTRUCTORS[dtype][0](this.data);
        };
        p.valueOf = p.get = function () {
          return useGetters ? this.data.get(this.offset) : this.data[this.offset];
        };
        p.set = function (v) {
          if (useGetters) {
            return this.data.set(this.offset, v);
          }
          this.data[this.offset] = v;
          return v;
        };
        return function construct_View0(a, b, c, d) {
          return new View0(a, d);
        };
      }
      function ViewN(data, shape, stride, offset) {
        // Copy the arrays exactly like the original generated constructor did
        // (this.shape = [b0, b1, ...]), so a caller mutating its own shape or
        // stride array can never alias a live view.
        this.data = data;
        this.shape = shape.slice(0, dimension);
        this.stride = stride.slice(0, dimension);
        this.offset = offset | 0;
      }
      var p = ViewN.prototype;
      p.dtype = dtype;
      p.dimension = dimension;
      Object.defineProperty(p, "size", {
        get: function () {
          var s = this.shape, result = 1;
          for (var i = 0; i < s.length; ++i) {
            result *= s[i];
          }
          return result;
        }
      });
      if (dimension === 1) {
        p.order = [0];
      } else if (dimension === 2) {
        Object.defineProperty(p, "order", {
          get: function () {
            return Math.abs(this.stride[0]) > Math.abs(this.stride[1]) ? [1, 0] : [0, 1];
          }
        });
      } else if (dimension === 3) {
        Object.defineProperty(p, "order", {
          get: function () {
            var s0 = Math.abs(this.stride[0]), s1 = Math.abs(this.stride[1]), s2 = Math.abs(this.stride[2]);
            if (s0 > s1) {
              if (s1 > s2) return [2, 1, 0];
              else if (s0 > s2) return [1, 2, 0];
              else return [1, 0, 2];
            } else if (s0 > s2) {
              return [2, 0, 1];
            } else if (s2 > s1) {
              return [0, 1, 2];
            } else {
              return [0, 2, 1];
            }
          }
        });
      } else {
        Object.defineProperty(p, "order", {
          get: function () {
            return order.call(this);
          }
        });
      }
      p.index = function () {
        var result = this.offset;
        for (var i = 0; i < dimension; ++i) {
          result += this.stride[i] * arguments[i];
        }
        return result;
      };
      p.get = function () {
        var result = this.offset;
        for (var i = 0; i < dimension; ++i) {
          result += this.stride[i] * arguments[i];
        }
        return useGetters ? this.data.get(result) : this.data[result];
      };
      p.set = function () {
        var v = arguments[dimension];
        var result = this.offset;
        for (var i = 0; i < dimension; ++i) {
          result += this.stride[i] * arguments[i];
        }
        if (useGetters) {
          return this.data.set(result, v);
        }
        this.data[result] = v;
        return v;
      };
      p.hi = function () {
        var shape = new Array(dimension);
        for (var i = 0; i < dimension; ++i) {
          var v = arguments[i];
          shape[i] = typeof v !== "number" || v < 0 ? this.shape[i] : v | 0;
        }
        return new ViewN(this.data, shape, this.stride.slice(0, dimension), this.offset);
      };
      p.lo = function () {
        var offset = this.offset;
        var shape = new Array(dimension);
        for (var i = 0; i < dimension; ++i) {
          var v = arguments[i];
          var s = this.shape[i];
          if (typeof v === "number" && v >= 0) {
            var d = v | 0;
            offset += this.stride[i] * d;
            s -= d;
          }
          shape[i] = s;
        }
        return new ViewN(this.data, shape, this.stride.slice(0, dimension), offset);
      };
      p.step = function () {
        var shape = new Array(dimension);
        var stride = new Array(dimension);
        var offset = this.offset;
        for (var i = 0; i < dimension; ++i) {
          var s = this.shape[i];
          var b = this.stride[i];
          var v = arguments[i];
          if (typeof v === "number") {
            var d = v | 0;
            if (d < 0) {
              offset += b * (s - 1);
              s = Math.ceil(-s / d);
            } else {
              s = Math.ceil(s / d);
            }
            b *= d;
          }
          shape[i] = s;
          stride[i] = b;
        }
        return new ViewN(this.data, shape, stride, offset);
      };
      p.transpose = function () {
        var shape = new Array(dimension);
        var stride = new Array(dimension);
        for (var i = 0; i < dimension; ++i) {
          var v = arguments[i];
          var j = v === undefined ? i : v | 0;
          shape[i] = this.shape[j];
          stride[i] = this.stride[j];
        }
        return new ViewN(this.data, shape, stride, this.offset);
      };
      p.pick = function () {
        var shape = [];
        var stride = [];
        var offset = this.offset;
        for (var i = 0; i < dimension; ++i) {
          var v = arguments[i];
          if (typeof v === "number" && v >= 0) {
            offset = offset + this.stride[i] * v | 0;
          } else {
            shape.push(this.shape[i]);
            stride.push(this.stride[i]);
          }
        }
        var ctor = CACHED_CONSTRUCTORS[dtype][shape.length + 1];
        return ctor(this.data, shape, stride, offset);
      };
      return function construct_ViewN(data, shape, stride, offset) {
        return new ViewN(data, shape, stride, offset);
      };
    }
